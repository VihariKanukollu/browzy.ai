---
title: TypeScript Generics
tags: [typescript, generics, types, javascript]
sources: [https://www.typescriptlang.org/docs/handbook/2/generics.html]
summary: Generic types in TypeScript including constraints, utility types, conditional types, and mapped types.
created: 2025-05-15
updated: 2025-11-10
backlinks: [react-hooks]
---

# TypeScript Generics

Generics allow you to write reusable components that work with a variety of types rather than a single one. They provide type safety without sacrificing flexibility.

## Basic Generics

A generic function uses a type parameter that acts as a placeholder for the actual type:

```typescript
function identity<T>(arg: T): T {
  return arg;
}

const result = identity<string>("hello"); // T is string
const inferred = identity(42); // T inferred as number
```

## Generic Constraints

You can constrain a generic type to ensure it has certain properties using the `extends` keyword:

```typescript
interface HasLength {
  length: number;
}

function logLength<T extends HasLength>(arg: T): void {
  console.log(arg.length);
}
```

This ensures that only types with a `length` property can be passed.

## Generic Interfaces and Classes

Generics can be applied to interfaces and classes to create reusable data structures:

```typescript
interface Repository<T> {
  getById(id: string): T | undefined;
  save(item: T): void;
  findAll(): T[];
}
```

## Utility Types

TypeScript provides built-in utility types that use generics:

- **Partial<T>**: Makes all properties optional.
- **Required<T>**: Makes all properties required.
- **Readonly<T>**: Makes all properties readonly.
- **Pick<T, K>**: Creates a type with only the specified keys.
- **Omit<T, K>**: Creates a type excluding the specified keys.
- **Record<K, V>**: Creates an object type with keys K and values V.
- **ReturnType<T>**: Extracts the return type of a function type.
- **Parameters<T>**: Extracts parameter types as a tuple.

## Conditional Types

Conditional types select one of two types based on a condition:

```typescript
type IsString<T> = T extends string ? true : false;
type Result = IsString<"hello">; // true
type Result2 = IsString<42>; // false
```

The `infer` keyword can extract types within conditional types, enabling powerful type-level programming.

## Mapped Types

Mapped types transform properties of an existing type:

```typescript
type Optional<T> = {
  [K in keyof T]?: T[K];
};
```

Combined with template literal types, mapped types can perform string transformations on property names.

## Best Practices

- Prefer inferring generic parameters over requiring explicit annotation.
- Use constraints to document what capabilities a type must have.
- Avoid unnecessary generics — if a function always works with string, just use string.
- Name type parameters descriptively when there are multiple (e.g., TKey, TValue instead of T, U).
