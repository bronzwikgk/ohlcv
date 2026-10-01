export const SMOOTHING_OPTIONS = [
    { id: "none", name: "No Smoothing" },
    { id: "sma", name: "SMA (Simple Moving Average)" },
    { id: "ema", name: "EMA (Exponential Moving Average)" },
    { id: "kernel", name: "Kernel Regression (Gaussian)" }
];

export const DERIVATIVES_CONFIG = [
    // --- 1ST ORDER DERIVATIVES ---
    {
        id: "normalized_slope",
        name: "Normalized Slope (Direction + Speed)",
        category: "1st_order",
        what_is_it: "A measure of how fast the price is moving per bar.",
        calculation: "Slope 'b' from Linear Regression divided by the average price over the window, then multiplied by 252 and 100. Formula: (b / avg_price) * 252 * 100.",
        interpretation: "Positive (>0) = Uptrend. Negative (<0) = Downtrend. Represents the annualized percentage return velocity, making a 5-dollar stock directly comparable to a 500-dollar stock.",
        usage: "Rank stocks by momentum.",
        config: {
            requires_source: false,
            lookback_options: [20, 60, 200],
            default_lookback: 20,
            allow_smoothing: true,
            allow_custom_source: true,
            reference_lines: [
                { price: 0, color: 'rgba(0, 0, 0, 0.8)', title: 'Zero', style: 0 }
            ]
        }
    },
    {
        id: "r_squared",
        name: "R-Squared (Trend Cleanliness)",
        category: "1st_order",
        what_is_it: "Measures how much price movement is explained by the trend.",
        calculation: "Square of Pearson correlation coefficient.",
        interpretation: ">0.8 = Clean trend. <0.5 = Choppy.",
        usage: "Primary trend filter to avoid sideways markets.",
        config: {
            requires_source: false,
            lookback_options: [20, 60, 200],
            default_lookback: 20,
            allow_smoothing: true
        }
    },
    {
        id: "std_residual",
        name: "Normalized Std of Residuals (Noise Size)",
        category: "1st_order",
        what_is_it: "Measures price deviation from the trend line.",
        calculation: "Standard deviation of residuals divided by avg price, then annualized. Formula: (std_residual / avg_price) * sqrt(252) * 100.",
        interpretation: "Small = tight trend. Large = loose/noisy trend. Annualizing the noise allows direct mathematical comparison against the annualized slope.",
        usage: "Calculate stop-loss width and position size.",
        config: {
            requires_source: false,
            lookback_options: [20, 60, 200],
            default_lookback: 20,
            allow_smoothing: true
        }
    },
    {
        id: "t_stat",
        name: "t-Statistic of the Slope (Reliability)",
        category: "1st_order",
        what_is_it: "Confidence score that the trend is real.",
        calculation: "t = slope / Standard Error of the slope.",
        interpretation: "> 2 means the trend is statistically significant.",
        usage: "Strict entry gate. Don't trade unconfirmed slopes.",
        config: {
            requires_source: false,
            lookback_options: [20, 60, 200],
            default_lookback: 20,
            allow_smoothing: true,
            reference_lines: [
                { price: 0, color: 'rgba(0, 0, 0, 0.8)', title: 'Zero', style: 0 },
                { price: 2, color: '#00e676', title: '+2', style: 2 },
                { price: -2, color: '#ff1744', title: '-2', style: 2 }
            ]
        }
    },

    // --- 2ND ORDER DERIVATIVES ---
    {
        id: "acceleration",
        name: "Acceleration (Slope of Slope)",
        category: "2nd_order",
        what_is_it: "The rate of change of the trend's velocity.",
        calculation: "Linear regression slope calculated on the array of the 1st-order Normalized Slope, annualized. Formula: slope(Normalized Slope) * 252.",
        interpretation: "Positive = momentum gaining (speeding up). Negative = momentum exhausting (slowing down).",
        usage: "Predict trend reversals before price changes direction.",
        config: {
            requires_source: true,
            default_source: "normalized_slope",
            lookback_options: [5, 10, 20],
            default_lookback: 10,
            allow_smoothing: true,
            allow_custom_source: true,
            reference_lines: [
                { price: 0, color: 'rgba(0, 0, 0, 0.8)', title: 'Zero', style: 0 }
            ]
        }
    },
    {
        id: "jerk",
        name: "Jerk (Momentum of Acceleration)",
        category: "3rd_order",
        what_is_it: "The rate of change of Acceleration.",
        calculation: "Linear regression slope calculated on Acceleration.",
        interpretation: "Positive = acceleration is speeding up. Negative = acceleration is slowing down.",
        usage: "Advanced momentum shifting.",
        config: {
            requires_source: true,
            default_source: "acceleration",
            lookback_options: [5, 10, 20],
            default_lookback: 5,
            allow_smoothing: true,
            allow_custom_source: true,
            reference_lines: [
                { price: 0, color: 'rgba(0, 0, 0, 0.8)', title: 'Zero', style: 0 }
            ]
        }
    },
    {
        id: "volatility_coil",
        name: "Volatility Coil (Trend of Noise)",
        category: "2nd_order",
        what_is_it: "Detects if a stock's trading range is tightening.",
        calculation: "Linear regression slope of the Std_Residual.",
        interpretation: "Negative slope = volatility compressing (coiling). Positive = expanding.",
        usage: "Find structural breakouts before they happen.",
        config: {
            requires_source: true,
            default_source: "std_residual",
            lookback_options: [10, 20, 40],
            default_lookback: 20,
            allow_smoothing: true,
            reference_lines: [
                { price: 0, color: 'rgba(0, 0, 0, 0.8)', title: 'Zero', style: 0 }
            ]
        }
    },
    {
        id: "consistency_delta",
        name: "Consistency Delta (Regime Change)",
        category: "2nd_order",
        what_is_it: "The difference between Micro and Macro trend organization.",
        calculation: "Micro R-Squared minus Macro R-Squared.",
        interpretation: "Positive spike = Sudden institutional awakening in a previously dead stock.",
        usage: "Early detection of structural regime changes.",
        config: {
            requires_source: true,
            default_source: "r_squared",
            lookback_options: [20], // Hardcoded calculation lookback
            default_lookback: 20,
            allow_smoothing: true,
            reference_lines: [
                { price: 0, color: 'rgba(0, 0, 0, 0.8)', title: 'Zero', style: 0 }
            ]
        }
    },
    {
        id: "efficiency_ratio",
        name: "Efficiency Ratio (Trend Smoothness)",
        category: "1st_order",
        what_is_it: "Measures how efficiently a stock moves from point A to point B.",
        calculation: "Absolute Net Price Change / Sum of Absolute Daily Changes.",
        interpretation: "Values near 1.0 indicate a perfectly smooth trend (no pullbacks). Values near 0 indicate high volatility and sideways chop.",
        usage: "Used to identify if a trend is clean enough to trade, or as a dynamic smoothing factor.",
        config: {
            requires_source: false,
            lookback_options: [10, 20, 60],
            default_lookback: 20,
            allow_smoothing: true,
            fixed_scale: { min: 0.0, max: 1.0 },
            reference_lines: [
                { price: 1.0, color: 'rgba(255, 255, 255, 0.4)', title: 'Max', style: 2 },
                { price: 0.8, color: '#00e676', title: 'Smooth (0.8)', style: 0 },
                { price: 0.3, color: '#ff1744', title: 'Chop (0.3)', style: 0 },
                { price: 0.0, color: 'rgba(255, 255, 255, 0.4)', title: 'Min', style: 2 }
            ]
        }
    },
    {
        id: "historical_volatility",
        name: "Historical Volatility (HV)",
        category: "1st_order",
        what_is_it: "Measures the magnitude of price swings regardless of direction.",
        calculation: "Standard deviation of logarithmic daily returns, annualized (multiplied by sqrt of 252).",
        interpretation: "High values (> 40%) indicate a choppy, explosive, or noisy stock. Low values (< 20%) indicate a smooth, slow-moving stock.",
        usage: "Used to distinguish between violent 'Swingers' and calm 'Trenders'.",
        config: {
            requires_source: false,
            lookback_options: [10, 20, 60],
            default_lookback: 20,
            allow_smoothing: true
        }
    },
    {
        id: "rolling_winrate",
        name: "Rolling Win Rate (Probability)",
        category: "1st_order",
        what_is_it: "Measures the historical probability of profit over a rolling window.",
        calculation: "Percentage of positive N-day holding returns over the lookback window.",
        interpretation: "High values (>70%) indicate a strong, consistent uptrend regime. Low values (<30%) indicate a chop or downtrend regime.",
        usage: "Used to determine if the current regime mathematically supports swing trading.",
        config: {
            requires_source: false,
            lookback_options: [3, 8, 21],
            default_lookback: 21,
            allow_smoothing: true
        }
    },
    {
        id: "returns_profile",
        name: "Returns Profile (Histogram)",
        category: "1st_order",
        what_is_it: "A statistical histogram of historical holding period returns.",
        calculation: "Computes the percentage return for a fixed holding period over every single day in the visible chart window, then groups them into frequency bins.",
        interpretation: "The shape of the curve shows the distribution of outcomes. A right-skewed curve indicates high probability of outsized gains.",
        usage: "Used to determine the mathematical expectancy and Win Rate of holding the asset for N days within the current regime.",
        config: {
            requires_source: false,
            lookback_options: [21],
            default_lookback: 21,
            allow_smoothing: false
        }
    },
    {
        id: "rsi",
        name: "Relative Strength Index (RSI)",
        category: "1st_order",
        what_is_it: "Momentum oscillator measuring the speed and change of price movements.",
        calculation: "100 - (100 / (1 + (Average Gain / Average Loss)))",
        interpretation: "Traditionally >70 is overbought, <30 is oversold.",
        usage: "Used to identify extreme momentum conditions.",
        config: {
            requires_source: false,
            lookback_options: [14],
            default_lookback: 14,
            allow_smoothing: true,
            allow_custom_source: true,
            fixed_scale: { min: 0, max: 100 },
            reference_lines: [
                { price: 70, color: '#ff1744', title: 'Overbought (70)', style: 2 },
                { price: 30, color: '#00e676', title: 'Oversold (30)', style: 2 }
            ]
        }
    },
    {
        id: "roc",
        name: "Rate of Change (ROC)",
        category: "1st_order",
        what_is_it: "Pure velocity / percentage return over a set period.",
        calculation: "((Price Today - Price N-Days Ago) / Price N-Days Ago) * 100",
        interpretation: "Positive values indicate upward velocity, negative values downward.",
        usage: "Used to rank pure point-to-point performance.",
        config: {
            requires_source: false,
            lookback_options: [10, 20, 60],
            default_lookback: 20,
            allow_smoothing: true,
            allow_custom_source: true,
            reference_lines: [
                { price: 0, color: 'rgba(0, 0, 0, 0.8)', title: 'Zero Line', style: 0 }
            ]
        }
    },
    {
        id: "roc_acceleration",
        name: "ROC Acceleration",
        category: "2nd_order",
        what_is_it: "Measures whether the velocity (ROC) is speeding up or slowing down.",
        calculation: "Current ROC - Previous ROC of the same window length.",
        interpretation: "Positive values mean the trend is accelerating. Negative values mean it's decelerating.",
        usage: "Used to spot early exhaustion (deceleration) before the actual price reverses.",
        config: {
            requires_source: false,
            lookback_options: [10, 20],
            default_lookback: 10,
            allow_smoothing: true,
            reference_lines: [
                { price: 0, color: 'rgba(0, 0, 0, 0.8)', title: 'Zero Line', style: 0 }
            ]
        }
    },
    {
        id: "pivot_high",
        name: "Pivot Point [High]",
        category: "1st_order",
        what_is_it: "Identifies strict local highs based on left and right lookback.",
        calculation: "Scans a narrow window (e.g. 5:5) backward and forward to find a strict local extrema on the High price.",
        interpretation: "Used for immediate term trailing stops and reactive entries.",
        usage: "Draw it on the price chart using the markers UI (Value > 0).",
        config: {
            requires_source: false,
            default_source: "high",
            lookback_options: ["3:3", "5:5", "8:8", "21:21"],
            default_lookback: "5:5",
            allow_smoothing: false,
            allow_custom_source: true
        }
    },
    {
        id: "pivot_low",
        name: "Pivot Point [Low]",
        category: "1st_order",
        what_is_it: "Identifies strict local lows based on left and right lookback.",
        calculation: "Scans a window (e.g. 5:5) backward and forward to find a strict local extrema on the Low price.",
        interpretation: "Used to define the macro trend structure (Higher Highs, Lower Lows).",
        usage: "Draw it on the price chart using the markers UI.",
        config: {
            requires_source: false,
            default_source: "low",
            lookback_options: ["3:3", "5:5", "8:8", "21:21"],
            default_lookback: "5:5",
            allow_smoothing: false,
            allow_custom_source: true
        }
    }
];
