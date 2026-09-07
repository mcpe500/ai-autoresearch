"""
prepare.py - Fixed Ground-Truth Benchmark Harness for Universal Sub-1-Bit Neural Quantization
=============================================================================================
DO NOT MODIFY THIS FILE.
This file defines the fixed evaluation ground truth, Canonical Neural IR representation,
and bit-accounting engine according to goal.md.
"""

import math
import time
from dataclasses import dataclass
from typing import Dict, List, Tuple, Any, Optional
import torch
import torch.nn.functional as F

# Fixed random seed for deterministic benchmarks
BENCHMARK_SEED = 1337

@dataclass
class LayerIR:
    """Canonical Neural IR for a single neural network layer."""
    name: str
    layer_type: str  # 'linear', 'conv2d_flat', 'attn_proj'
    weight: torch.Tensor  # shape (out_features, in_features)
    bias: Optional[torch.Tensor]
    inputs: torch.Tensor  # calibration inputs (batch_size, in_features)

    def forward(self, w: Optional[torch.Tensor] = None) -> torch.Tensor:
        """Run reference forward pass."""
        weight_to_use = self.weight if w is None else w
        out = F.linear(self.inputs, weight_to_use, self.bias)
        if self.layer_type == 'linear':
            return F.relu(out)
        elif self.layer_type == 'conv2d_flat':
            return F.silu(out)
        elif self.layer_type == 'attn_proj':
            # Simulated attention softmax scale
            return F.gelu(out)
        return out


def generate_canonical_neural_ir() -> List[LayerIR]:
    """
    Generates representative Canonical Neural IR layers across 3 key architectures:
    1. MLP hidden projection (256 x 256)
    2. Conv feature projection (128 x 128)
    3. Transformer Attention projection (512 x 512, heavy-tail singular spectrum)
    """
    generator = torch.Generator().manual_seed(BENCHMARK_SEED)
    layers = []

    # 1. MLP Layer: Gaussian weights with standard initialization
    w1 = torch.randn(256, 256, generator=generator) * (math.sqrt(2.0 / 256.0))
    b1 = torch.randn(256, generator=generator) * 0.01
    x1 = torch.randn(64, 256, generator=generator)
    layers.append(LayerIR("mlp_hidden", "linear", w1, b1, x1))

    # 2. Conv Feature Layer: 128 x 128
    w2 = torch.randn(128, 128, generator=generator) * (math.sqrt(2.0 / 128.0))
    b2 = torch.zeros(128)
    x2 = torch.randn(64, 128, generator=generator)
    layers.append(LayerIR("conv_feature", "conv2d_flat", w2, b2, x2))

    # 3. Transformer Attention Projection: 512 x 512 with power-law singular values
    u, _, v = torch.linalg.svd(torch.randn(512, 512, generator=generator))
    ranks = torch.arange(1, 513, dtype=torch.float32)
    s = 1.0 / (ranks ** 0.6)  # heavy-tail decay characteristic of LLM weights
    w3 = (u @ torch.diag(s) @ v) * (math.sqrt(1.0 / 512.0) / s.mean().item())
    b3 = None
    x3 = torch.randn(64, 512, generator=generator)
    layers.append(LayerIR("transformer_attn_qkv", "attn_proj", w3, b3, x3))

    return layers


@dataclass
class CompressedRepresentation:
    """
    Strict bit-accounting structure for sub-1-bit compressed weights.
    Every bit must be explicitly declared and verified.
    """
    layer_name: str
    reconstructed_weight: torch.Tensor  # shape (M, N)
    
    # Mode 1: Binary low-rank factorization: W ~ sum_{k=1}^R alpha_k (b_k * c_k^T)
    # b_k in {-1, +1}^M, c_k in {-1, +1}^N
    rank: int = 0
    num_binary_vectors_left: int = 0   # M * rank bits
    num_binary_vectors_right: int = 0  # N * rank bits
    num_fp16_scales: int = 0           # rank * 16 bits
    
    # Mode 2: Vector Quantization / Codebook (optional)
    codebook_vectors: int = 0          # K * dim * 16 bits
    num_codebook_indices: int = 0      # indices count * ceil(log2(K)) bits
    codebook_k: int = 0

    # Mode 3: Sparse Ternary Residual (optional: {-1, 0, +1})
    num_sparse_residuals: int = 0      # nonzeros * (ceil(log2(M*N)) + 2) bits
    
    # Metadata overhead
    overhead_bits: int = 32            # 32 bits for shape and config header

    def compute_total_bits(self, total_elements: int) -> int:
        bits = self.overhead_bits
        
        # Binary basis bits: 1 bit per entry in {-1, +1}
        if self.rank > 0:
            bits += self.num_binary_vectors_left * 1
            bits += self.num_binary_vectors_right * 1
            bits += self.num_fp16_scales * 16
            
        # Codebook bits
        if self.codebook_k > 0 and self.codebook_vectors > 0:
            index_bits = math.ceil(math.log2(max(2, self.codebook_k)))
            bits += self.num_codebook_indices * index_bits
            bits += self.codebook_vectors * 16
            
        # Sparse residual bits
        if self.num_sparse_residuals > 0:
            pos_bits = math.ceil(math.log2(max(2, total_elements)))
            bits += self.num_sparse_residuals * (pos_bits + 2)  # pos + sign + flag
            
        return bits


def evaluate_quantizer(compressed_layers: Dict[str, CompressedRepresentation]) -> Dict[str, Any]:
    """
    Evaluates compressed layers against ground-truth Canonical Neural IR.
    Computes exact BPW, functional degradation, and Pareto score.
    """
    canonical_layers = generate_canonical_neural_ir()
    
    total_weights = 0
    total_bits = 0
    degradation_list = []
    
    for layer in canonical_layers:
        num_weights = layer.weight.numel()
        total_weights += num_weights
        
        if layer.name not in compressed_layers:
            raise ValueError(f"Missing compressed representation for layer: {layer.name}")
            
        comp = compressed_layers[layer.name]
        layer_bits = comp.compute_total_bits(num_weights)
        total_bits += layer_bits
        
        w_rec = comp.reconstructed_weight
        if w_rec.shape != layer.weight.shape:
            raise ValueError(f"Shape mismatch for {layer.name}: expected {layer.weight.shape}, got {w_rec.shape}")
            
        # Check for NaN / Inf
        if not torch.isfinite(w_rec).all():
            raise ValueError(f"Non-finite values detected in reconstructed weights for {layer.name}")
            
        # Evaluate functional output distortion
        with torch.no_grad():
            y_orig = layer.forward(layer.weight)
            y_quant = layer.forward(w_rec)
            
            norm_orig = torch.norm(y_orig, p='fro').item()
            norm_diff = torch.norm(y_orig - y_quant, p='fro').item()
            rel_error = (norm_diff / (norm_orig + 1e-8)) * 100.0
            degradation_list.append(rel_error)

    bpw = total_bits / total_weights
    degradation_pct = sum(degradation_list) / len(degradation_list)
    compression_ratio = 16.0 / bpw  # relative to FP16 baseline
    
    # Pareto Score: Lower is better
    # Target: Sub-1-Bit (BPW < 1.0) with minimal degradation
    pareto_score = bpw + 0.1 * degradation_pct
    if bpw >= 1.0:
        pareto_score += 10.0  # Disqualification penalty for failing sub-1-bit target
    if degradation_pct > 25.0:
        pareto_score += 10.0  # Penalty for excessive functional collapse
        
    return {
        "bpw": round(bpw, 4),
        "degradation_pct": round(degradation_pct, 4),
        "pareto_score": round(pareto_score, 4),
        "compression_ratio": round(compression_ratio, 2),
        "total_weights": total_weights,
        "total_bits": total_bits,
    }


def print_metrics_summary(metrics: Dict[str, Any], elapsed_sec: float, peak_vram_mb: float = 0.0):
    """Prints standard machine-parseable metrics summary block."""
    print("---")
    print(f"bpw:                 {metrics['bpw']:.4f}")
    print(f"degradation_pct:     {metrics['degradation_pct']:.4f}")
    print(f"pareto_score:        {metrics['pareto_score']:.4f}")
    print(f"compression_ratio:   {metrics['compression_ratio']:.2f}x")
    print(f"total_weights:       {metrics['total_weights']}")
    print(f"total_bits:          {metrics['total_bits']}")
    print(f"training_seconds:    {elapsed_sec:.2f}")
    print(f"peak_vram_mb:        {peak_vram_mb:.1f}")


if __name__ == "__main__":
    # Self-test: evaluate an uncompressed or mock representation
    start = time.time()
    layers = generate_canonical_neural_ir()
    print(f"Loaded {len(layers)} Canonical IR layers successfully.")
    for l in layers:
        print(f" - {l.name} ({l.layer_type}): {l.weight.shape[0]}x{l.weight.shape[1]} params={l.weight.numel()}")
    print(f"Ground truth verification completed in {time.time() - start:.3f}s")
