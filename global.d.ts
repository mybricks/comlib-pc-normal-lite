declare module '*.lazy.less' {
  interface LazyCSSModule {
    use(): void;
    unuse(): void;
    locals: { [key: string]: string };
  }
  const resource: LazyCSSModule;
  export default resource;
}

declare module '*.less' {
  const classes: { [key: string]: string };
  export default classes;
}

interface Window {
  eslint: typeof import('eslint');
}
