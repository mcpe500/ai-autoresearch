# Universal Sub-1-Bit Neural Quantizer: Autonomous Research Protocol

This is an autonomous AI research project to discover algorithms for **Universal Sub-1-Bit Neural Quantization** (< 1.0 Bit Per Weight, e.g. 0.8, 0.6, 0.5 BPW) with negligible functional degradation, based on the blueprint in `goal.md`.

## Setup & Rules of Engagement

1. **Only One File to Modify**:
   - You ONLY edit `train.py`.
   - You NEVER modify `prepare.py`. It is read-only and contains the ground-truth Canonical Neural IR layers, bit accounting, and distortion evaluation.
   - Do NOT add external pip dependencies. Stick to PyTorch and standard library.
2. **Fixed Time Budget**:
   - The script must execute in under 60 seconds on CPU. Keep computations efficient (vectorized PyTorch, fast matrix multiplications, avoid O(N^3) operations).
3. **Objective**:
   - **Minimize `pareto_score`**!
   - Ground truth Pareto formula: `pareto_score = bpw + 0.1 * degradation_pct` (+ penalties if BPW >= 1.0 or degradation > 25%).
   - The primary goal is achieving true sub-1-bit compression (BPW < 1.0, ideally 0.5 - 0.8 BPW) with minimum functional degradation.

## Research Agenda & Exploration Axes (from goal.md)

Explore the following research axes sequentially or in combination:

1. **Binary Factor Optimization**:
   - Binary bases: $W \approx \sum_{k=1}^R \alpha_k (b_k c_k^T)$ where $b_k \in \{-1, +1\}^M, c_k \in \{-1, +1\}^N$.
   - Try coordinate descent, sign projection refinement, or joint least-squares scale estimation ($\alpha = (B \odot C)^{\dagger} W$).
   - Explore shared binary basis matrices across layers or heads.
2. **Sensitivity Prediction & Dynamic Bit Allocation**:
   - Not all layers tolerate quantization equally. Attention projection layers require more capacity than MLP or Conv feature layers.
   - Allocate higher rank $R$ to sensitive layers and lower rank to redundant layers while keeping overall BPW < 0.75.
3. **Codebook Vector Quantization (VQ) & Code Sharing**:
   - Codebook vectors shared across tensor patches with small index bitwidth ($\lceil \log_2(K) \rceil$ bits).
   - Residual error quantization: quantize the residual of low-rank factors using small binary codebooks.
4. **Ternary Residuals**:
   - Extremely sparse ternary residuals ($\{-1, 0, +1\}$) for the top outlier weights to dramatically cut functional degradation.
5. **Simplicity Wins**:
   - All else equal, simpler, faster code is better. A small improvement with ugly hacky code should be discarded. A clean simplification with equal score should be kept.

## Execution Loop

1. Formulate a clear hypothesis explaining *why* a specific algorithmic change in `train.py` should improve the Pareto score or reduce degradation.
2. Implement the exact change in `train.py`.
3. Run the experiment: `python3 train.py`.
4. Parse the output delimiter (`---`).
5. If `pareto_score` improved: KEEP the change and record why.
6. If `pareto_score` worsened or crashed: DISCARD and learn from the failure.
