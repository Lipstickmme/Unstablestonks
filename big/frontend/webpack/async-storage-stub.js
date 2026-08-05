// Stub for @react-native-async-storage/async-storage in web environment
// This module is not needed in browser environments

const stub = {
  getItem: async () => null,
  setItem: async () => {},
  removeItem: async () => {},
  clear: async () => {},
  getAllKeys: async () => [],
  multiGet: async () => [],
  multiSet: async () => {},
  multiRemove: async () => {},
};

// Support both default and named exports
export default stub;
export const getItem = stub.getItem;
export const setItem = stub.setItem;
export const removeItem = stub.removeItem;
export const clear = stub.clear;
export const getAllKeys = stub.getAllKeys;
export const multiGet = stub.multiGet;
export const multiSet = stub.multiSet;
export const multiRemove = stub.multiRemove;

