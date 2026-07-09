use async_trait::async_trait;
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;
use specta::Type;

use crate::error::RpcErr;

/// Object-safe erased handler stored in the router.
#[async_trait]
pub trait ErasedHandler<Ctx>: Send + Sync {
    fn name(&self) -> &'static str;
    async fn call(&self, ctx: &Ctx, input: Value) -> Result<Value, RpcErr>;
}

/// Typed RPC function trait.
///
/// Implement this directly, or use the `#[rpc_fn]` proc macro.
#[async_trait]
pub trait RpcFn<Ctx>: Send + Sync {
    type Input: DeserializeOwned + Type;
    type Output: Serialize + Type;
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

    async fn call(&self, ctx: &Ctx, input: Value) -> Result<Value, RpcErr> {
        let input: F::Input = serde_json::from_value(input)
            .map_err(|e| RpcErr(format!("deserialize input: {e}")))?;
        let output = F::exec(ctx, input).await?;
        Ok(serde_json::to_value(output)
            .map_err(|e| RpcErr(format!("serialize output: {e}")))?)
    }
}
