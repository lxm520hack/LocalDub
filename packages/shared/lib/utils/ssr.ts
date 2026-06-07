
export const debugSsr = (...data: any[]) => console.log(`Running on ${typeof window === 'undefined' ? 'server' : 'client'}`, ...data);