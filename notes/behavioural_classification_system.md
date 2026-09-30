# Behavioural Signature and Classification System for OHLCV Data

## Problem Statement
Stock charts appear chaotic, and every stock has a different nominal price and volatility profile. It is extremely difficult to scan thousands of stocks and identify which ones are exhibiting identical mathematical behaviors. We need a standardized method to strip away the actual stock price and measure *how* the stock is moving, so we can group similar price actions logically without relying on lagging, subjective chart indicators.

## Objective
To mathematically measure the exact shape of a stock's movement—its direction, acceleration, momentum, volatility, noise, consistency, and extension—over specific time blocks. By converting these physical properties into normalized values, we create a strict, programmatic "Signature Hash" for any stock at any given moment.

## Solution Overview
A dual-timeframe quantitative pipeline that extracts statistical features using **Weighted Least Squares (WLS)** regression. 
* **The Macro Lookback (54-Day WLS):** Determines the overarching institutional tide.
* **The Micro Lookback (13-Day WLS):** Determines the immediate momentum setup.
The metrics are normalized so that all stocks can be ranked cross-sectionally and strictly categorized into Hash Signatures.

---

## The 7 Core Physical Properties (The Derivatives)

### 1. Direction (Linear Regression Slope)
* **What it measures:** Is the trend pointing up or down?
* **Nomenclature:** `UP` (Slope > 0) | `DN` (Slope < 0)

### 2. Acceleration (Delta of the Slope)
* **What it measures:** Is the trend getting steeper or flattening out? 
* **Nomenclature:** `(ris)` (Rising/Accelerating) | `(dec)` (Descending/Decelerating)

### 3. Momentum / Velocity (Normalized Rate of Change)
* **What it measures:** The raw speed, normalized into a 0-100 percentile rank.
* **Nomenclature:** `fast` (Rank > 80) | `base` (Rank 20-80) | `slow` (Rank < 20)

### 4. Volatility / Magnitude (Standard Deviation of Returns)
* **What it measures:** The size of the daily price swings. 
* **Nomenclature:** `wide` (Violent, expanding ranges) | `coil` (Tight, compressed ranges / The Spring)

### 5. Noise / Cleanliness (Standard Error)
* **What it measures:** How closely the actual prices hug the perfect Regression line.
* **Nomenclature:** `chop` (Erratic, retail-driven mess) | `clean` (Smooth, algorithmic control)

### 6. Consistency (R-Squared & R-Squared Acceleration)
* **What it measures:** How much of the stock's movement is explained by the trendline vs random chaos, and *is that consistency improving?* (Modeled after Institutional R2Trend).
* **Nomenclature:** 
  * Baseline: `steady` (High R2) | `erratic` (Low R2)
  * Acceleration: `(ris)` (R2 is rising, stock is getting cleaner) | `(dec)` (R2 is falling)
  * Example: `steady(ris)`

### 7. Extension (Z-Score Relative Position)
* **What it measures:** How far the current price is stretched away from the Regression baseline today.
* **Nomenclature:** `ext` (Z-score > 2, Dangerously overbought/oversold) | `rest` (Z-Score near 0, sitting on support)

---

## The Signature Hash System
**Hash Format:** 
`[MicroDir(Accel)-MacroDir(Accel)-Momentum-Volatility-Noise-Consistency(Accel)-Extension]`

### Examples of Behavioral Hashes:

* **The Perfect Launchpad:** `[DN13(dec)-UP54(ris)-slow-coil-clean-steady(ris)-rest]`
  * *Translation:* The 54-day macro trend is UP and accelerating. The 13-day micro trend has pulled back (DN) but is decelerating. Volatility is tightly compressed (coil), the price action is organized (clean) and the consistency is high and improving (steady(ris)). Crucially, the stock is resting perfectly on its baseline (rest). 

* **The Breakout Ignition:** `[UP13(ris)-UP54(ris)-fast-wide-clean-steady(dec)-ext]`
  * *Translation:* Both timeframes are pointing UP and accelerating. Momentum is fast, volatility is expanding as buyers rush in, the trend is clean but consistency is starting to fray as it goes parabolic (steady(dec)), and it is actively extending away from the mean (ext).

---

## The Execution Pipeline
1. **Feature Extractor:** Calculates the WLS Regression, SD, SE, R2, and Z-Score over 13/54-day blocks.
2. **Normalizer:** Converts raw metrics into standard percentiles and percentages.
3. **Classifier:** Assigns the exact Signature Hash to the stock for that specific day.
4. **Trigger Engine:** The trading algorithm scans the database for a target hash. When found, it executes via a structural chart Pivot.
