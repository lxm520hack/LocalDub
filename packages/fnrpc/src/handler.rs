use async_trait::async_trait;
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;
use specta::{NamedType, Type};
use std::any::type_name;

fn short_type_name<T: ?Sized>() -> &'static str {
    let full = type_name::<T>();
    full.rsplit("::").next().unwrap_or(full)
}

use crate::error::RpcErr;

/// Object-safe erased handler stored in the router.
#[async_trait]
pub trait ErasedHandler<Ctx>: Send + Sync {
    fn name(&self) -> &'static str;
    fn input_type_name(&self) -> &'static str;
    fn output_type_name(&self) -> &'static str;
    async fn call(&self, ctx: &Ctx, input: Value) -> Result<Value, RpcErr>;
    fn export_ts(&self) -> String;
}

/// Typed RPC function trait.
///
/// Implement this directly, or use the `#[rpc_fn]` proc macro.
#[async_trait]
pub trait RpcFn<Ctx>: Send + Sync {
    type Input: DeserializeOwned + Type + NamedType;
    type Output: Serialize + Type + NamedType;
    const NAME: &'static str;

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

    fn input_type_name(&self) -> &'static str {
        short_type_name::<F::Input>()
    }

    fn output_type_name(&self) -> &'static str {
        short_type_name::<F::Output>()
    }

    async fn call(&self, ctx: &Ctx, input: Value) -> Result<Value, RpcErr> {
        let input: F::Input = serde_json::from_value(input)
            .map_err(|e| RpcErr(format!("deserialize input: {e}")))?;
        let output = F::exec(ctx, input).await?;
        Ok(serde_json::to_value(output)
            .map_err(|e| RpcErr(format!("serialize output: {e}")))?)
    }

    fn export_ts(&self) -> String {
        let mut out = String::new();
        let input_ts = specta_typescript::export::<F::Input>(&Default::default())
            .unwrap_or_default();
        let output_ts = specta_typescript::export::<F::Output>(&Default::default())
            .unwrap_or_default();
        out.push_str(&input_ts);
        out.push('\n');
        out.push_str(&output_ts);
        out
    }
}
