#!/usr/bin/env python3
import json
import sys
import numpy as np
import matplotlib.pyplot as plt
from pathlib import Path

def load_response_times(json_file):
    times = []
    with open(json_file, 'r') as f:
        for line in f:
            try:
                obj = json.loads(line)
                if (obj.get('metric') == 'http_req_duration' and
                    obj.get('type') == 'Point'):
                    times.append(obj['data']['value'])
            except json.JSONDecodeError:
                continue
    return np.array(times)

def plot_percentiles(times, output_file):
    percentiles = list(range(0, 100, 2)) + [99, 99.5, 99.9, 100]
    values = np.percentile(times, percentiles)

    plt.figure(figsize=(10, 6))
    plt.scatter(percentiles, values, c='blue', s=20, alpha=0.7)
    plt.xlabel('Percentil')
    plt.ylabel('Vrijeme izvršenja (ms)')
    plt.title('Percentili vremena odgovora')
    plt.grid(True, alpha=0.3)
    plt.xticks([0, 25, 50, 75, 100])

    plt.tight_layout()
    plt.savefig(output_file, dpi=150)
    plt.close()
    print(f"Saved: {output_file}")

def plot_histogram(times, output_file):
    plt.figure(figsize=(10, 6))
    plt.hist(times, bins=300, edgecolor='black', alpha=0.7)
    plt.xlabel('Vrijeme (ms)')
    plt.ylabel('Broj zahtjeva')
    plt.title('Distribucija vremena odgovora')
    plt.grid(True, alpha=0.3, axis='y')

    stats_text = f'Prosjek: {np.mean(times):.1f}ms\nMedijan: {np.median(times):.1f}ms\nStd: {np.std(times):.1f}ms'
    plt.text(0.95, 0.95, stats_text, transform=plt.gca().transAxes,
             verticalalignment='top', horizontalalignment='right',
             bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.5))

    plt.tight_layout()
    plt.savefig(output_file, dpi=150)
    plt.close()
    print(f"Saved: {output_file}")

def main():
    if len(sys.argv) < 2:
        print("Usage: python analyze.py <input.json> [label]")
        sys.exit(1)

    input_file = sys.argv[1]
    label = sys.argv[2] if len(sys.argv) > 2 else Path(input_file).stem

    print(f"Loading {input_file}...")
    times = load_response_times(input_file)
    print(f"Loaded {len(times)} data points")

    output_dir = Path(input_file).parent
    base_name = label.lower().replace(' ', '-')

    plot_percentiles(times, output_dir / f"{base_name}-percentiles.png")
    plot_histogram(times, output_dir / f"{base_name}-histogram.png")

    print(f"\n=== {label} Statistika ===")
    print(f"Ukupno zahtjeva: {len(times)}")
    print(f"Prosjek: {np.mean(times):.2f} ms")
    print(f"Medijan (p50): {np.median(times):.2f} ms")
    print(f"p90: {np.percentile(times, 90):.2f} ms")
    print(f"p95: {np.percentile(times, 95):.2f} ms")
    print(f"p99: {np.percentile(times, 99):.2f} ms")
    print(f"Max: {np.max(times):.2f} ms")

if __name__ == '__main__':
    main()
