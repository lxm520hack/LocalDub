use std::collections::HashMap;

use serde_json::Value;

use crate::error::RpcErr;
use crate::handler::ErasedHandler;

pub struct RpcRouter<Ctx> {
    handlers: HashMap<&'static str, Box<dyn ErasedHandler<Ctx>>>,
}

impl<Ctx> RpcRouter<Ctx>
where
    Ctx: Send + Sync + 'static,
{
    pub fn new() -> Self {
        Self {
            handlers: HashMap::new(),
        }
    }

    pub fn add<H: ErasedHandler<Ctx> + 'static>(&mut self, handler: H) -> &mut Self {
        let name = handler.name();
        self.handlers.insert(name, Box::new(handler));
        self
    }

    pub async fn dispatch(
        &self,
        ctx: &Ctx,
        method: &str,
        input: Value,
    ) -> Result<Value, RpcErr> {
        let handler = self
            .handlers
            .get(method)
            .ok_or_else(|| RpcErr(format!("unknown method: {method}")))?;
        handler.call(ctx, input).await
    }
}
