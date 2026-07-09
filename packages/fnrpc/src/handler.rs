use async_trait::async_trait;
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;
use specta::datatype::{DataType, FunctionResultVariant};
use specta::{Generics, Type, TypeCollection};

use crate::error::RpcErr;

/// TypeScript export info for a single type (input or output).
#[derive(Debug, Clone)]
pub struct TsTypeInfo {
    /// Named export statement (e.g. `export type Foo = { ... };\n`), empty if inlined.
    pub named_export: String,
    /// Inline TS expression or type name reference.
    pub ts_ref: String,
}

/// Generate TS info for a type using only `Type` (no `NamedType` required).
fn type_ts<T: Type>() -> TsTypeInfo {
    let mut type_map = TypeCollection::default();
    let data_type = T::inline(&mut type_map, Generics::NONE);

    // Extract name from struct/enum without borrowing data_type
    let name = match &data_type {
        DataType::Struct(s) => Some(s.name().clone()),
        DataType::Enum(e) => Some(e.name().clone()),
        _ => None,
    };

    if let Some(name) = name {
        let named_dt = data_type.to_named(name.clone());
        if let Ok(export) =
            specta_typescript::export_named_datatype(&Default::default(), &named_dt, &type_map)
        {
            return TsTypeInfo {
                named_export: format!("{export}\n"),
                ts_ref: name.to_string(),
            };
        }
        // If export failed, fall through to inline
        unreachable!("specta export_named_datatype should not fail for valid types");
    }

    let inline = specta_typescript::datatype(
        &Default::default(),
        &FunctionResultVariant::Value(data_type),
        &type_map,
    )
    .unwrap_or_else(|_| "unknown".to_string());

    TsTypeInfo {
        named_export: String::new(),
        ts_ref: inline,
    }
}

/// Object-safe erased handler stored in the router.
#[async_trait]
pub trait ErasedHandler<Ctx>: Send + Sync {
    fn name(&self) -> &'static str;
    fn kind(&self) -> &'static str;
    fn input_ts(&self) -> TsTypeInfo;
    fn output_ts(&self) -> TsTypeInfo;
    async fn call(&self, ctx: &Ctx, input: Value) -> Result<Value, RpcErr>;
}

/// Typed RPC function trait.
///
/// Implement this directly, or use the `#[rpc_query]` / `#[rpc_mutation]` proc macros.
#[async_trait]
pub trait RpcFn<Ctx>: Send + Sync {
    type Input: DeserializeOwned + Type;
    type Output: Serialize + Type;
    const NAME: &'static str;
    const KIND: &'static str = "query";

    async fn exec(ctx: &Ctx, input: Self::Input) -> Result<Self::Output, RpcErr>;
}

/// Blanket impl: any `RpcFn<Ctx>` becomes an `ErasedHandler<Ctx>`.
#[async_trait]
impl<Ctx, F> ErasedHandler<Ctx> for F
where
    F: RpcFn<Ctx> + Send + Sync,
    Ctx: Send + Sync,
{
    fn name(&self) -> &'static str {
        F::NAME
    }

    fn kind(&self) -> &'static str {
        F::KIND
    }

    fn input_ts(&self) -> TsTypeInfo {
        type_ts::<F::Input>()
    }

    fn output_ts(&self) -> TsTypeInfo {
        type_ts::<F::Output>()
    }

    async fn call(&self, ctx: &Ctx, input: Value) -> Result<Value, RpcErr> {
        let input: F::Input = serde_json::from_value(input)
            .map_err(|e| RpcErr(format!("deserialize input: {e}")))?;
        let output = F::exec(ctx, input).await?;
        Ok(serde_json::to_value(output)
            .map_err(|e| RpcErr(format!("serialize output: {e}")))?)
    }
}
