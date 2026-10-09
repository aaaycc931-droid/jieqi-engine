// Opt-in workaround for restricted containers where Node cannot enumerate OS
// interfaces. Test server binding remains explicitly 127.0.0.1. No fabricated
// external addresses or network measurements; CI normally does not use this.
import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
const original = os.networkInterfaces;
os.networkInterfaces = () => {
  try { return original(); }
  catch (e) { if (e.code === 'ERR_SYSTEM_ERROR' && e.info?.syscall === 'uv_interface_addresses') return {}; throw e; }
};
syncBuiltinESMExports();
