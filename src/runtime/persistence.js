import { deepClone } from './utils.js';

export class MemoryPersistenceAdapter {
  #snapshot;

  constructor(initialSnapshot = null) {
    this.#snapshot = initialSnapshot ? deepClone(initialSnapshot) : null;
  }

  load() {
    return this.#snapshot ? deepClone(this.#snapshot) : null;
  }

  save(snapshot) {
    this.#snapshot = deepClone(snapshot);
  }

  exportSnapshot() {
    return this.load();
  }

  replaceSnapshot(snapshot) {
    this.#snapshot = deepClone(snapshot);
  }
}
