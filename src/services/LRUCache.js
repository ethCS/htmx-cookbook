class Node {
  constructor(key, value) {
    this.key = key;
    this.value = value;
    this.prev = null;
    this.next = null;
  }
}

class LRUCache {
  constructor(capacity = 50) {
    this.capacity = capacity;
    this.map = new Map();
    this.head = new Node(null, null);
    this.tail = new Node(null, null);
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  _removeNode(node) {
    node.prev.next = node.next;
    node.next.prev = node.prev;
  }

  _addToHead(node) {
    node.next = this.head.next;
    node.prev = this.head;
    this.head.next.prev = node;
    this.head.next = node;
  }

  _moveToHead(node) {
    this._removeNode(node);
    this._addToHead(node);
  }

  _evict() {
    const lru = this.tail.prev;
    if (lru === this.head) return;
    this._removeNode(lru);
    this.map.delete(lru.key);
  }

  get(key) {
    const node = this.map.get(key);
    if (!node) return undefined;
    this._moveToHead(node);
    return node.value;
  }

  has(key) {
    return this.map.has(key);
  }

  put(key, value) {
    const existing = this.map.get(key);
    if (existing) {
      existing.value = value;
      this._moveToHead(existing);
      return;
    }
    if (this.map.size >= this.capacity) {
      this._evict();
    }
    const node = new Node(key, value);
    this.map.set(key, node);
    this._addToHead(node);
  }

  delete(key) {
    const node = this.map.get(key);
    if (!node) return;
    this._removeNode(node);
    this.map.delete(key);
  }

  get size() {
    return this.map.size;
  }
}

const cache = new LRUCache(50);
export default cache;
