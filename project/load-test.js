import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const responseTimeTrend = new Trend('response_time_ms');
const requestsCounter = new Counter('total_requests');
const errorsCounter = new Counter('errors');

export const options = {
    scenarios: {
        constant_load: {
            executor: 'constant-vus',
            vus: 200,
            duration: '5m',
        },
    },
    thresholds: {
        http_req_duration: ['p(95)<3000'],
        errors: ['count<100'],
    },
};

export default function () {
    const url = 'http://localhost:8080/ping';

    const startTime = Date.now();
    const response = http.get(url, {
        timeout: '10s',
    });
    const endTime = Date.now();

    const responseTime = endTime - startTime;
    responseTimeTrend.add(responseTime);
    requestsCounter.add(1);

    const success = check(response, {
        'status is 200': (r) => r.status === 200,
        'response has pong': (r) => r.body && r.body.includes('pong'),
        'has instance header': (r) => r.headers['X-Instance-Id'] !== undefined ||
                                       r.headers['X-Upstream-Addr'] !== undefined,
    });

    if (!success) {
        errorsCounter.add(1);
        console.log(`Error: status=${response.status}, body=${response.body}`);
    }

    try {
        const body = JSON.parse(response.body);
        if (body.instance) {
        }
    } catch (e) {
    }

    sleep(0.1);
}

export function handleSummary(data) {
    const summary = {
        timestamp: new Date().toISOString(),
        duration: data.state.testRunDurationMs,
        vus: options.scenarios.constant_load.vus,
        metrics: {
            requests: {
                total: data.metrics.http_reqs ? data.metrics.http_reqs.values.count : 0,
                rate: data.metrics.http_reqs ? data.metrics.http_reqs.values.rate : 0,
            },
            response_time: {
                avg: data.metrics.http_req_duration ? data.metrics.http_req_duration.values.avg : 0,
                min: data.metrics.http_req_duration ? data.metrics.http_req_duration.values.min : 0,
                max: data.metrics.http_req_duration ? data.metrics.http_req_duration.values.max : 0,
                p50: data.metrics.http_req_duration ? data.metrics.http_req_duration.values['p(50)'] : 0,
                p90: data.metrics.http_req_duration ? data.metrics.http_req_duration.values['p(90)'] : 0,
                p95: data.metrics.http_req_duration ? data.metrics.http_req_duration.values['p(95)'] : 0,
                p99: data.metrics.http_req_duration ? data.metrics.http_req_duration.values['p(99)'] : 0,
            },
            errors: data.metrics.errors ? data.metrics.errors.values.count : 0,
        },
    };

    return {
        'results/summary.json': JSON.stringify(summary, null, 2),
        stdout: textSummary(data, { indent: ' ', enableColors: true }),
    };
}

function textSummary(data, options) {
    const metrics = data.metrics;
    let output = '\n';
    output += '================== LOAD TEST RESULTS ==================\n\n';

    if (metrics.http_reqs) {
        output += `Total Requests: ${metrics.http_reqs.values.count}\n`;
        output += `Request Rate: ${metrics.http_reqs.values.rate.toFixed(2)} req/s\n\n`;
    }

    if (metrics.http_req_duration) {
        output += 'Response Time:\n';
        output += `  Average: ${metrics.http_req_duration.values.avg.toFixed(2)} ms\n`;
        output += `  Min: ${metrics.http_req_duration.values.min.toFixed(2)} ms\n`;
        output += `  Max: ${metrics.http_req_duration.values.max.toFixed(2)} ms\n`;
        output += `  p(50): ${metrics.http_req_duration.values['p(50)'].toFixed(2)} ms\n`;
        output += `  p(90): ${metrics.http_req_duration.values['p(90)'].toFixed(2)} ms\n`;
        output += `  p(95): ${metrics.http_req_duration.values['p(95)'].toFixed(2)} ms\n`;
        output += `  p(99): ${metrics.http_req_duration.values['p(99)'].toFixed(2)} ms\n\n`;
    }

    if (metrics.http_req_failed) {
        output += `Failed Requests: ${(metrics.http_req_failed.values.rate * 100).toFixed(2)}%\n`;
    }

    output += '========================================================\n';

    return output;
}
