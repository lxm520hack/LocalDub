type ToReturn<T, E> = Promise<[T, null] | [null, E]>;
type ToSyncReturn<T, E> = [T, null] | [null, E];

// 重载1: Promise → async
export  function to<T, E = Error>(promise: Promise<T>): ToReturn<T, E>;
// 重载2: 同步函数 → 同步
export function to<T, E = Error>(fn: () => T): ToSyncReturn<T, E>

export function to<T, E = Error>(
  promise: Promise<T> | (() => T),
): ToReturn<T, E> | ToSyncReturn<T, E> {
  if (typeof promise === 'function') {
    try {
      const data = promise();
      return [data, null];
    } catch (err) {
      return [null, err as E];
    }
  }
  return (promise as Promise<T>)
    .then((data): [T, null] => [data, null])
    .catch((err): [null, E] => [null, err as E]);
}