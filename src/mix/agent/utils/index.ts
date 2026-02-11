export class PromiseStack {
  stack: any[] = [];
  currentPromise: any = null;

  add(promiseFn: any) {
    this.stack.push(promiseFn);
    this.run();
  }

  async run() {
    let catchNext = false;
    try {
      if (this.currentPromise) {
        return;
      }
      const promiseFn = this.stack.shift();
      if (promiseFn) {
        const promise = promiseFn();
        if (Object.prototype.toString.call(promise) === "[object Promise]") {
          this.currentPromise = promise;
          catchNext = true;
          await promise;
          this.currentPromise = null;
          this.run();
        } else {
          this.run();
        }
      }
    } catch (e) {
      console.error(e)
      if (catchNext) {
        this.currentPromise = null;
        this.run();
      }
    }
  }
}