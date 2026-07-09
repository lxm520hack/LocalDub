use proc_macro::TokenStream;
use quote::quote;
use syn::{
    parse_macro_input, FnArg, GenericArgument, ItemFn, PathArguments, ReturnType, Type,
    TypeReference,
};

struct RegistryInput {
    ctx_ty: syn::Type,
    fns: Vec<syn::Ident>,
}

impl syn::parse::Parse for RegistryInput {
    fn parse(input: syn::parse::ParseStream) -> syn::Result<Self> {
        let kw: syn::Ident = input.parse()?;
        if kw != "Router" {
            return Err(syn::Error::new(kw.span(), "expected `Router`"));
        }
        input.parse::<syn::Token![<]>()?;
        let ctx_ty: syn::Type = input.parse()?;
        input.parse::<syn::Token![>]>()?;
        input.parse::<syn::Token![=]>()?;
        let content;
        syn::bracketed!(content in input);
        let mut fns = Vec::new();
        while !content.is_empty() {
            let ident: syn::Ident = content.parse()?;
            fns.push(ident);
            if content.is_empty() {
                break;
            }
            let _: syn::Token![,] = content.parse()?;
        }
        Ok(RegistryInput { ctx_ty, fns })
    }
}

#[proc_macro]
pub fn fnrpc_registry(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as RegistryInput);
    let ctx_ty = &input.ctx_ty;
    let fn_structs: Vec<syn::Ident> = input
        .fns
        .iter()
        .map(|f| syn::Ident::new(&format!("{}__FnRpc", f), f.span()))
        .collect();

    quote! {
        pub fn build_fn_rpc() -> fnrpc::router::RpcRouter<#ctx_ty> {
            fnrpc::router::RpcRouter::new()
                #(.route(#fn_structs))*
        }
    }
    .into()
}

fn rpc_fn_impl(kind: &str, item: TokenStream) -> TokenStream {
    let input_fn = parse_macro_input!(item as ItemFn);
    let fn_name = &input_fn.sig.ident;
    let fn_vis = &input_fn.vis;

    // --- Analyse parameters: infer Ctx from first param type ---
    // If first param is `&T`, it's the context (Ctx = T); otherwise no context (Ctx = ())
    let params: Vec<&FnArg> = input_fn.sig.inputs.iter().collect();

    let (has_ctx, ctx_ty) = if let Some(FnArg::Typed(pat)) = params.first() {
        if let Type::Reference(TypeReference { elem, .. }) = pat.ty.as_ref() {
            (true, quote! { #elem })
        } else {
            (false, quote! { () })
        }
    } else {
        (false, quote! { () })
    };

    let input_idx = if has_ctx { 1 } else { 0 };
    let has_input_param = if has_ctx { params.len() > 1 } else { !params.is_empty() };

    // --- Extract output type (auto-wrap non-Result in Ok) ---
    let (output_ty, is_result_return) = match &input_fn.sig.output {
        ReturnType::Type(_, ty) => {
            if let Type::Path(type_path) = ty.as_ref() {
                let last_seg = type_path.path.segments.last().unwrap();
                if last_seg.ident == "Result" {
                    if let PathArguments::AngleBracketed(args) = &last_seg.arguments {
                        match args.args.first().unwrap() {
                            GenericArgument::Type(t) => (quote! { #t }, true),
                            _ => panic!("expected type in Result<T, E>"),
                        }
                    } else {
                        panic!("expected Result<T, E>");
                    }
                } else {
                    (quote! { #ty }, false)
                }
            } else {
                (quote! { #ty }, false)
            }
        }
        ReturnType::Default => panic!("function must have a return type"),
    };

    // --- Build the call expression to the original function ---
    let call = if has_ctx {
        if has_input_param {
            quote! { #fn_name(ctx, input).await }
        } else {
            quote! { #fn_name(ctx).await }
        }
    } else {
        if has_input_param {
            quote! { #fn_name(input).await }
        } else {
            quote! { #fn_name().await }
        }
    };

    let exec_body = if is_result_return {
        quote! {
            match #call {
                Ok(val) => Ok(val),
                Err(e) => Err(fnrpc::error::RpcErr(e.to_string())),
            }
        }
    } else {
        quote! { Ok(#call) }
    };

    // --- Extract input type ---
    let input_ty: proc_macro2::TokenStream = if has_input_param {
        match &params[input_idx] {
            FnArg::Typed(pat_type) => {
                let ty = &pat_type.ty;
                quote! { #ty }
            }
            _ => panic!("parameter must be typed"),
        }
    } else {
        quote! { () }
    };

    let struct_name = syn::Ident::new(&format!("{}__FnRpc", fn_name), fn_name.span());

    let expanded = quote! {
        #input_fn

        #[allow(non_camel_case_types, dead_code)]
        #fn_vis struct #struct_name;

        #[async_trait::async_trait]
        impl fnrpc::handler::RpcFn<#ctx_ty> for #struct_name {
            type Input = #input_ty;
            type Output = #output_ty;
            const NAME: &'static str = stringify!(#fn_name);
            const KIND: &'static str = #kind;

            async fn exec(ctx: &#ctx_ty, input: Self::Input) -> Result<Self::Output, fnrpc::error::RpcErr> {
                #exec_body
            }
        }
    };

    expanded.into()
}

#[proc_macro_attribute]
pub fn rpc_query(_attr: TokenStream, item: TokenStream) -> TokenStream {
    rpc_fn_impl("query", item)
}

#[proc_macro_attribute]
pub fn rpc_mutation(_attr: TokenStream, item: TokenStream) -> TokenStream {
    rpc_fn_impl("mutation", item)
}

#[proc_macro_attribute]
pub fn rpc_subscription(_attr: TokenStream, item: TokenStream) -> TokenStream {
    rpc_fn_impl("subscription", item)
}
