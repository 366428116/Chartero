declare const addon: import('./addon').default;
declare const rootURI: string;
declare const __dev__: boolean;

declare type ReactDOM = typeof import('react-dom');
declare module '*.sass';
declare class PromiseWorker extends Worker {
    postMessage: undefined;
    onmessage: undefined;
    post: (method: string, args: any[]) => Promise<any>;
}

declare type MaybeArray<T> = T | T[];
