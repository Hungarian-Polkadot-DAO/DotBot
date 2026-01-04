/**
 * Manual mock for @polkadot/util-crypto
 * 
 * This mock recognizes valid Polkadot SS58 addresses used in tests
 */
const VALID_TEST_ADDRESSES = [
  '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
  '14E5nqKAp3oAJcmzgZhUD2RcptBeUBScxKHgJKU4HPNcKVf3',
  '14Gjs1TD93gnwEBfDMHoCgsuf1s2TVKUP6Z1qKmAZnZ8cW5q',
];

export const isAddress = jest.fn((address: string) => {
  // Return true for valid test addresses or any non-empty string starting with '1' (Polkadot) and having reasonable length
  if (!address || address.trim().length === 0) {
    return false;
  }
  
  // Check if it's one of our known test addresses
  if (VALID_TEST_ADDRESSES.includes(address)) {
    return true;
  }
  
  // For other addresses, check basic Polkadot SS58 format (starts with '1' and has reasonable length)
  // Real SS58 addresses are typically 47-48 characters
  if (address.startsWith('1') && address.length >= 40 && address.length <= 50) {
    return true;
  }
  
  return false;
});

