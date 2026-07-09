use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;

use crate::error::RpcErr;

/// Core service trait — call a method with JSON input, get JSON output.
#[async_trait]
pub trait FnService<Ctx>: Send + Sync {
    async fn call(&self, ctx: &Ctx, method: &str, input: Value) -> Result<Value, RpcErr>;
}

/// Blanket impl so `Box<dyn FnService<Ctx>>` works as a service.
#[async_trait]
impl<Ctx: Send + Sync> FnService<Ctx> for Box<dyn FnService<Ctx>> {
    async fn call(&self, ctx: &Ctx, method: &str, input: Value) -> Result<Value, RpcErr> {
        (**self).call(ctx, method, input).await
    }
}

/// A composable middleware layer.
///
/// ```ignore
/// router.use(MyLayer);
/// ```
pub trait FnLayer<Ctx>: Send + Sync {
    fn layer(&self, inner: Box<dyn FnService<Ctx>>) -> Box<dyn FnService<Ctx>>;
}

// ── Hook layer (convenience) ──────────────────────────────

type BeforeHook<Ctx> =
    Arc<dyn Fn(&Ctx, &str, &mut Value) -> Result<(), RpcErr> + Send + Sync>;

type AfterHook<Ctx> =
    Arc<dyn Fn(&Ctx, &str, &mut Result<Value, RpcErr>) + Send + Sync>;

pub struct HookLayer<Ctx> {
    before: Option<BeforeHook<Ctx>>,
    after: Option<AfterHook<Ctx>>,
}

impl<Ctx> HookLayer<Ctx> {
    pub fn new() -> Self {
        Self {
            before: None,
            after: None,
        }
    }

    pub fn before<F>(mut self, f: F) -> Self
    where
        F: Fn(&Ctx, &str, &mut Value) -> Result<(), RpcErr> + Send + Sync + 'static,
    {
        self.before = Some(Arc::new(f));
        self
    }

    pub fn after<F>(mut self, f: F) -> Self
    where
        F: Fn(&Ctx, &str, &mut Result<Value, RpcErr>) + Send + Sync + 'static,
    {
        self.after = Some(Arc::new(f));
        self
    }
}

struct HookService<Ctx> {
    inner: Box<dyn FnService<Ctx>>,
    before: Option<BeforeHook<Ctx>>,
    after: Option<AfterHook<Ctx>>,
}

#[async_trait]
impl<Ctx: Send + Sync + 'static> FnService<Ctx> for HookService<Ctx> {
    async fn call(&self, ctx: &Ctx, method: &str, mut input: Value) -> Result<Value, RpcErr> {
        if let Some(ref before) = self.before {
            before(ctx, method, &mut input)?;
        }
        let mut result = self.inner.call(ctx, method, input).await;
        if let Some(ref after) = self.after {
            after(ctx, method, &mut result);
        }
        result
    }
}

impl<Ctx: Send + Sync + 'static> FnLayer<Ctx> for HookLayer<Ctx> {
    fn layer(&self, inner: Box<dyn FnService<Ctx>>) -> Box<dyn FnService<Ctx>> {
        Box::new(HookService {
            inner,
            before: self.before.clone(),
            after: self.after.clone(),
        })
    }
}
