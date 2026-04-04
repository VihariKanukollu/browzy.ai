---
title: Pandas DataFrames
tags: [python, pandas, data-science, dataframes]
sources: [https://pandas.pydata.org/docs/]
summary: Core DataFrame operations in pandas including groupby, merge, pivot, and data manipulation techniques.
created: 2025-01-10
updated: 2025-05-25
backlinks: [statistical-testing]
---

# Pandas DataFrames

A DataFrame is the primary data structure in the pandas library for Python. It represents a two-dimensional labeled table with columns of potentially different types, similar to a spreadsheet or SQL table.

## Creating DataFrames

DataFrames can be created from dictionaries, lists, NumPy arrays, CSV files, or database queries:

```python
import pandas as pd

df = pd.DataFrame({
    'name': ['Alice', 'Bob', 'Charlie'],
    'age': [25, 30, 35],
    'salary': [50000, 60000, 70000]
})
```

## Selection and Filtering

Access columns with bracket notation or dot syntax. Filter rows using boolean masks:

```python
engineers = df[df['department'] == 'Engineering']
high_salary = df[df['salary'] > 60000]
selected = df.loc[0:5, ['name', 'salary']]
```

## GroupBy Operations

GroupBy splits data into groups, applies a function, and combines results. It follows the split-apply-combine pattern:

```python
department_stats = df.groupby('department').agg({
    'salary': ['mean', 'median', 'std'],
    'age': 'mean'
})
```

GroupBy supports custom aggregation functions, multiple grouping keys, and transformation operations that return data aligned with the original DataFrame.

## Merge and Join

Merge combines DataFrames based on common columns, similar to SQL joins:

```python
result = pd.merge(employees, departments, on='dept_id', how='left')
```

Join types include inner (matching rows only), left (all from left, matching from right), right, and outer (all from both). The suffixes parameter handles column name conflicts.

## Pivot Tables

Pivot tables restructure data for analysis:

```python
pivot = df.pivot_table(
    values='revenue',
    index='region',
    columns='quarter',
    aggfunc='sum',
    fill_value=0
)
```

The melt function performs the inverse operation, converting wide-format data to long-format.

## Data Cleaning

Common cleaning operations include handling missing values, type conversion, and deduplication:

```python
df.dropna(subset=['important_col'])
df.fillna({'price': 0, 'category': 'Unknown'})
df['date'] = pd.to_datetime(df['date_str'])
df.drop_duplicates(subset=['id'], keep='last')
```

## Performance Tips

- Use categorical dtypes for low-cardinality string columns to save memory.
- Vectorized operations are significantly faster than iterating with loops.
- Use `query()` for readable filtering of large DataFrames.
- Chain operations with `.pipe()` for cleaner code.
- Consider using chunked reading for files that do not fit in memory.

## Time Series

Pandas has strong time series support with DatetimeIndex, resampling, and rolling windows:

```python
daily = df.resample('D').mean()
rolling_avg = df['price'].rolling(window=7).mean()
```
