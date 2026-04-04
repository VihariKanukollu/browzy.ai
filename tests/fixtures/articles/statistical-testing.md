---
title: Statistical Hypothesis Testing
tags: [statistics, hypothesis-testing, p-values, data-science]
sources: [https://www.khanacademy.org/math/statistics-probability]
summary: Foundations of hypothesis testing including p-values, confidence intervals, significance levels, and common statistical tests.
created: 2025-01-05
updated: 2025-04-18
backlinks: [pandas-dataframes]
---

# Statistical Hypothesis Testing

Hypothesis testing is a formal procedure for deciding whether the evidence in a sample is strong enough to reject a claim about a population parameter. It is a cornerstone of scientific research and data-driven decision making.

## Null and Alternative Hypotheses

Every hypothesis test starts with two competing claims:

- **Null hypothesis (H0)**: The default assumption, typically stating no effect or no difference.
- **Alternative hypothesis (H1 or Ha)**: The claim we are trying to find evidence for.

For example, when testing whether a new drug is effective, H0 might state that the drug has no effect, while H1 states it reduces symptoms.

## P-Values

A p-value is the probability of observing data as extreme as (or more extreme than) the actual result, assuming the null hypothesis is true. A small p-value indicates that the observed data is unlikely under H0.

Common significance thresholds: p < 0.05 (standard), p < 0.01 (strict), p < 0.001 (very strict). A p-value of 0.03 means there is a 3% chance of observing this result if the null hypothesis is true.

P-values do not tell you the probability that H0 is true or false. They measure the compatibility of the data with H0.

## Confidence Intervals

A 95% confidence interval means that if we repeated the experiment many times, 95% of the constructed intervals would contain the true parameter value. Wider intervals indicate more uncertainty.

Confidence intervals and hypothesis tests are complementary. If a 95% CI for a difference does not include zero, the corresponding two-sided test at alpha = 0.05 rejects H0.

## Type I and Type II Errors

- **Type I error (false positive)**: Rejecting H0 when it is actually true. The probability is controlled by the significance level alpha.
- **Type II error (false negative)**: Failing to reject H0 when it is actually false. The probability is denoted beta.
- **Statistical power (1 - beta)**: The probability of correctly rejecting a false H0. Power depends on sample size, effect size, and significance level.

## Common Tests

- **t-test**: Compares means of one or two groups. Assumes approximately normal distribution.
- **Chi-squared test**: Tests association between categorical variables.
- **ANOVA**: Compares means across three or more groups.
- **Mann-Whitney U test**: Non-parametric alternative to the independent t-test.
- **Kolmogorov-Smirnov test**: Tests whether a sample follows a specified distribution.

## Multiple Testing Problem

When performing many tests simultaneously, the probability of at least one false positive increases. Corrections include Bonferroni (divide alpha by number of tests), Benjamini-Hochberg (controls false discovery rate), and Holm-Bonferroni. These are critical in genomics, A/B testing, and any domain with many simultaneous comparisons.

## Effect Size

Statistical significance alone is insufficient. Effect size measures the practical magnitude of the difference. Cohen's d, odds ratios, and correlation coefficients are common effect size measures. A highly significant result can have a negligible effect size with large sample sizes.
