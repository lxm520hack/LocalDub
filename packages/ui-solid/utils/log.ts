import { createEffect } from "solid-js";

export const effectLog = (...data: any[])=>{
  createEffect(()=> {
    console.log(...data)
  })
}