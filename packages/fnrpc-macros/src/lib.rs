use proc_macro::TokenStream;
use quote::quote;
use syn::{
    parse_macro_input, FnArg, GenericArgument, ItemFn, PathArguments, ReturnType, Type,
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
        pub fn build_fn_rpc() -> ::std::sync::Arc<fnrpc::router::RpcRouter<#ctx_ty>> {
            let mut router = fnrpc::router::RpcRouter::new();
            #(
                router.add(#fn_structs);
            )*
            ::std::sync::Arc::new(router)
        }
    }
    .into()
}

#[proc_macro_attribute]
pub fn rpc_fn(attr: TokenStream, item: TokenStream) -> TokenStream {
    let input_fn = parse_macro_input!(item as ItemFn);
    let fn_name = &input_fn.sig.ident;
    let fn_vis = &input_fn.vis;

    let has_ctx = !attr.to_string().trim().is_empty();
    let ctx_ty = if has_ctx {
        let ts: proc_macro2::TokenStream = attr.to_string().parse().unwrap();
        quote! { #ts }
    } else {
        quote! { () }
    };

    // --- Extract output type from Result<T, E> ---
    let output_ty = match &input_fn.sig.output {
        ReturnType::Type(_, ty) => {
            if let Type::Path(type_path) = ty.as_ref() {
                let last_seg = type_path.path.segments.last().unwrap();
                if last_seg.ident == "Result" {
                    if let PathArguments::AngleBracketed(args) = &last_seg.arguments {
                        match args.args.first().unwrap() {
                            GenericArgument::Type(t) => quote! { #t },
                            _ => panic!("expected type in Result<T, E>"),
                        }
                    } else {
                        panic!("expected Result<T, E>");
                    }
                } else {
                    panic!("expected Result<T, E>, got {}", last_seg.ident);
                }
            } else {
                panic!("expected Result<T, E>");
            }
        }
        ReturnType::Default => panic!("function must have a return type"),
    };

    // --- Analyse parameters: count them ---
    let params: Vec<&FnArg> = input_fn.sig.inputs.iter().collect();
    let input_idx = if has_ctx { 1 } else { 0 };
    let has_input_param = if has_ctx { params.len() > 1 } else { !params.is_empty() };

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

            async fn exec(ctx: &#ctx_ty, input: Self::Input) -> Result<Self::Output, fnrpc::error::RpcErr> {
                match #call {
                    Ok(val) => Ok(val),
                    Err(e) => Err(fnrpc::error::RpcErr(e.to_string())),
                }
            }
        }
    };

    expanded.into()
}
