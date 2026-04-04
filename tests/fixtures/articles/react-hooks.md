---
title: React Hooks
tags: [react, hooks, javascript, frontend]
sources: [https://react.dev/reference/react]
summary: React Hooks API including useState, useEffect, custom hooks, and the rules governing their usage.
created: 2025-06-01
updated: 2025-12-01
backlinks: [typescript-generics]
---

# React Hooks

React Hooks are functions that let you use state and other React features in function components. Introduced in React 16.8, they replaced class components as the primary way to manage component state and side effects.

## useState

The useState hook declares a state variable. It returns an array with the current value and a setter function:

```tsx
const [count, setCount] = useState(0);
```

The setter can accept a new value directly or an updater function that receives the previous state. Use the updater form when the new state depends on the old state to avoid stale closure bugs.

## useEffect

useEffect lets you synchronize a component with an external system. It runs after render and can return a cleanup function:

```tsx
useEffect(() => {
  const subscription = api.subscribe(id);
  return () => subscription.unsubscribe();
}, [id]);
```

The dependency array controls when the effect re-runs. An empty array means it runs once on mount. Omitting the array means it runs after every render. Each value in the array is compared by reference (Object.is).

## useContext

useContext reads and subscribes to a React context. It provides a way to pass data through the component tree without prop drilling. When the context value changes, all consuming components re-render.

## useRef

useRef creates a mutable reference that persists across renders. Unlike state, changing a ref does not trigger a re-render. Common uses include storing DOM element references and keeping mutable values that should not cause re-renders.

## useMemo and useCallback

useMemo caches the result of an expensive computation between renders. useCallback caches a function definition. Both accept a dependency array and only recompute when dependencies change. Overusing these hooks can hurt readability without meaningful performance gains.

## Custom Hooks

Custom hooks are functions that start with "use" and can call other hooks. They allow you to extract reusable stateful logic:

```tsx
function useDebounce(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
```

## Rules of Hooks

1. Only call hooks at the top level — never inside loops, conditions, or nested functions.
2. Only call hooks from React function components or custom hooks.
3. Hook names must start with "use".

These rules ensure that hooks are called in the same order on every render, which is how React associates hook state with the correct component instance.

## Common Patterns

- **Data fetching**: Combine useState and useEffect to fetch data on mount or when dependencies change.
- **Form handling**: Use useState for form fields and useCallback for submit handlers.
- **Subscriptions**: Use useEffect with a cleanup function to subscribe and unsubscribe from event sources.
