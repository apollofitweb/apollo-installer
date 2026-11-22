/**
 * Test-only React shim.
 *
 * Vitest/vite-node on Windows evaluates an inlined copy of `react` while
 * `react-dom` (externalized) loads its own CommonJS copy. Two React instances
 * break the hooks dispatcher ("Invalid hook call" / useState of null).
 *
 * Aliasing `react` to this module in vitest.config.ts forces every source
 * import to resolve through the same CommonJS instance used by react-dom.
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// eslint-disable-next-line @typescript-eslint/no-var-requires
const React = require('react') as typeof import('react');

export default React;

export const useState = React.useState;
export const useEffect = React.useEffect;
export const useCallback = React.useCallback;
export const useMemo = React.useMemo;
export const useRef = React.useRef;
export const useContext = React.useContext;
export const createContext = React.createContext;
export const forwardRef = React.forwardRef;
export const memo = React.memo;
export const Fragment = React.Fragment;
export const StrictMode = React.StrictMode;
