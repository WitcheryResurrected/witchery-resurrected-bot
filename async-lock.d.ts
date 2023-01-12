export module 'async-lock' {
    export class AsyncLock {
        acquire<T>(key: string, callback: (done: (error, value?: T) => void) => void): T;
    }
}
