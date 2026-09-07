"""
train.py - Model A: Universal Neural Quantizer / Codec
======================================================
THIS IS THE ONLY FILE MODIFIED BY THE AUTONOMOUS AGENT.

Research Goal (from goal.md):
Universal Sub-1-Bit Quantization (< 1.0 BPW, targeting 0.8, 0.6, 0.5 BPW)
with minimal functional degradation on Canonical Neural IR layers.
"""

import time
import math
from typing import Dict
import torch
import prepare
from prepare import LayerIR, CompressedRepresentation, evaluate_quantizer, print_metrics_summary

# ==============================================================================
# Model A Architecture & Quantization Strategy
# ==============================================================================

class SensitivityPredictor:
    """Predicts layer sensitivity to allocate bit budgets non-uniformly."""
    def predict_rank_budget(self, layer: LayerIR, target_bpw: float = 0.70) -> int:
        out_f, in_f = layer.weight.shape
        num_weights = out_f * in_f
        bits_per_rank = (out_f + in_f) * 1 + 16  # binary vectors + fp16 scale
        
        # Max theoretical rank allowed within budget
        max_rank = int((num_weights * target_bpw - 32) / bits_per_rank)
        
        # Allocate based on layer type
        if layer.layer_type == 'attn_proj':
            alloc_rank = int(max_rank * 0.85)
        elif layer.layer_type == 'linear':
            alloc_rank = int(max_rank * 0.70)
        else:
            alloc_rank = int(max_rank * 0.55)
            
        return max(1, alloc_rank)


class BinaryLowRankCodec:
    """
    Core Model A Compressor:
    Decomposes weight matrix W into low-rank binary factor basis:
    W ~ sum_{k=1}^R alpha_k * (b_k @ c_k^T)
    where b_k in {-1, +1}^M, c_k in {-1, +1}^N, alpha_k in R+
    """
    def __init__(self, refinement_steps: int = 2):
        self.refinement_steps = refinement_steps

    def compress_layer(self, layer: LayerIR, rank: int) -> CompressedRepresentation:
        w = layer.weight.clone()
        out_f, in_f = w.shape
        residual = w.clone()
        
        b_factors = []
        c_factors = []
        scales = []
        
        # Fast power-iteration rank-1 extraction with alternating binary refinement
        # O(rank * M * N) complexity - fast on CPU
        for r in range(rank):
            # Fast leading component initialization via power iteration
            v0 = torch.randn(in_f)
            v0 = v0 / (torch.norm(v0) + 1e-8)
            u0 = residual @ v0
            u0 = u0 / (torch.norm(u0) + 1e-8)
            v0 = residual.t() @ u0
            
            b = torch.sign(u0)
            b[b == 0] = 1.0
            c = torch.sign(v0)
            c[c == 0] = 1.0
            
            # Alternating binary refinement steps
            for _ in range(self.refinement_steps):
                proj_c = residual.t() @ b
                c = torch.sign(proj_c)
                c[c == 0] = 1.0
                
                proj_b = residual @ c
                b = torch.sign(proj_b)
                b[b == 0] = 1.0
                
            # Optimal scalar scale alpha = (b^T residual c) / (||b||^2 * ||c||^2)
            denom = float(out_f * in_f)
            num = (b.unsqueeze(0) @ residual @ c.unsqueeze(1)).item()
            alpha = max(0.0, num / denom)
            
            b_factors.append(b)
            c_factors.append(c)
            scales.append(alpha)
            
            # Deflate residual
            rank1_approx = alpha * (b.unsqueeze(1) @ c.unsqueeze(0))
            residual = residual - rank1_approx
            
        # Reconstruct weight approximation
        w_rec = torch.zeros_like(w)
        for r in range(rank):
            w_rec += scales[r] * (b_factors[r].unsqueeze(1) @ c_factors[r].unsqueeze(0))
            
        return CompressedRepresentation(
            layer_name=layer.name,
            reconstructed_weight=w_rec,
            rank=rank,
            num_binary_vectors_left=out_f * rank,
            num_binary_vectors_right=in_f * rank,
            num_fp16_scales=rank,
            overhead_bits=32
        )


def main():
    start_time = time.time()
    
    # 1. Load Canonical Neural IR benchmark
    canonical_layers = prepare.generate_canonical_neural_ir()
    
    # 2. Instantiate Model A components
    sensitivity = SensitivityPredictor()
    codec = BinaryLowRankCodec(refinement_steps=2)
    
    # 3. Compress each layer under sub-1-bit target budget
    compressed_layers: Dict[str, CompressedRepresentation] = {}
    target_bpw = 0.70  # Target sub-1-bit average bitwidth
    
    for layer in canonical_layers:
        rank_budget = sensitivity.predict_rank_budget(layer, target_bpw=target_bpw)
        comp = codec.compress_layer(layer, rank=rank_budget)
        compressed_layers[layer.name] = comp
        
    elapsed = time.time() - start_time
    
    # 4. Ground-Truth Evaluation
    metrics = evaluate_quantizer(compressed_layers)
    
    # 5. Output Summary Block
    print_metrics_summary(metrics, elapsed_sec=elapsed, peak_vram_mb=0.0)


if __name__ == "__main__":
    main()
