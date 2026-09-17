"""Performance monitoring routes.

Expose system, Docker, and application performance metrics. This is a
CPU-only deployment; the GPU endpoints are retained for frontend
compatibility but always report an empty list.
"""

import json
import logging
import os
import subprocess
import time
from typing import Any, Dict, List, Optional

import psutil
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from app.core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/performance", tags=["performance"])

def get_gpu_stats():
    """CPU-only deployment: no GPUs. Kept so existing clients get a stable shape."""
    return []

# ---------------------------------------------------------------------------
# Container-scoped stats (cgroup v2) — unlike psutil's /proc-based reads
# above, these files ARE namespaced to just this container by Docker, so they
# match exactly what `docker stats` reports for it. No extra privileges or
# docker.sock access required — a container can always see its own cgroup.
# ---------------------------------------------------------------------------
_CGROUP_ROOT = "/sys/fs/cgroup"
_last_cpu_usage_usec: Optional[float] = None
_last_cpu_sample_time: Optional[float] = None


def _cgroup_v2_available() -> bool:
    return os.path.exists(os.path.join(_CGROUP_ROOT, "cgroup.controllers"))


def _read_cgroup_int(filename: str):
    try:
        with open(os.path.join(_CGROUP_ROOT, filename)) as f:
            value = f.read().strip()
            return None if value == "max" else int(value)
    except Exception:
        return None


def get_container_stats():
    """This container's own CPU/memory usage and limits (cgroup v2 only;
    returns None on cgroup v1 hosts so the field is simply omitted there)."""
    global _last_cpu_usage_usec, _last_cpu_sample_time
    if not _cgroup_v2_available():
        return None
    try:
        mem_used = _read_cgroup_int("memory.current")
        mem_limit = _read_cgroup_int("memory.max")  # None = no limit set

        cpu_stat = {}
        with open(os.path.join(_CGROUP_ROOT, "cpu.stat")) as f:
            for line in f:
                key, _, value = line.strip().partition(" ")
                if key:
                    cpu_stat[key] = int(value)
        usage_usec = cpu_stat.get("usage_usec")

        quota_raw, period_raw = open(os.path.join(_CGROUP_ROOT, "cpu.max")).read().split()
        period = int(period_raw)
        cpu_limit_cores = (int(quota_raw) / period) if quota_raw != "max" else float(psutil.cpu_count() or 1)

        cpu_percent = 0.0
        now = time.time()
        if usage_usec is not None and _last_cpu_usage_usec is not None and _last_cpu_sample_time is not None:
            delta_seconds = now - _last_cpu_sample_time
            if delta_seconds > 0:
                delta_cpu_seconds = (usage_usec - _last_cpu_usage_usec) / 1_000_000
                cpu_percent = max(0.0, min(100.0, (delta_cpu_seconds / delta_seconds / cpu_limit_cores) * 100))
        _last_cpu_usage_usec = usage_usec
        _last_cpu_sample_time = now

        return {
            "cpu_percent": round(cpu_percent, 1),
            "cpu_limit_cores": round(cpu_limit_cores, 2),
            "memory_used_bytes": mem_used,
            "memory_limit_bytes": mem_limit,
            "memory_percent": round((mem_used / mem_limit) * 100, 1) if mem_used and mem_limit else None,
        }
    except Exception as e:
        logger.debug(f"Container cgroup stats unavailable: {e}")
        return None

def get_docker_stats():
    """Get Docker container statistics.

    Expected to be unavailable in this deployment: the backend image has no
    `docker` CLI and no /var/run/docker.sock mount (deliberately — mounting
    the socket would give the container control over the whole Docker host).
    Logged at debug, not error, since the empty result is by design, not a
    fault; this function is polled every few seconds while the dashboard tab
    is open, so an error-level log here would just be noise.
    """
    try:
        result = subprocess.run([
            'docker', 'stats', '--no-stream', '--format', 
            'table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}\t{{.BlockIO}}\t{{.PIDs}}'
        ], capture_output=True, text=True, timeout=10)
        
        if result.returncode == 0:
            lines = result.stdout.strip().split('\n')[1:]  # Skip header
            containers = []
            for line in lines:
                if line.strip():
                    parts = line.split('\t')
                    if len(parts) >= 7:
                        containers.append({
                            "container": parts[0],
                            "cpu_percent": parts[1].replace('%', ''),
                            "memory_usage": parts[2],
                            "memory_percent": parts[3].replace('%', ''),
                            "network_io": parts[4],
                            "block_io": parts[5],
                            "pids": parts[6]
                        })
            return containers
        else:
            logger.warning(f"docker stats failed: {result.stderr}")
            return []
    except Exception as e:
        logger.debug(f"Docker stats unavailable (expected — no docker CLI/socket in this container): {e}")
        return []

def get_system_stats():
    """Get comprehensive system statistics.

    Uses interval=None (non-blocking): psutil returns the CPU delta since the
    last call instead of sleeping for a second. This endpoint is polled every
    few seconds by the dashboard, so blocking the request for a full second
    per poll would stall the whole async event loop (all other API traffic)
    for that second, on every poll, for as long as anyone has the tab open.
    """
    try:
        # CPU stats
        cpu_percent = psutil.cpu_percent(interval=None)
        cpu_count = psutil.cpu_count()
        cpu_freq = psutil.cpu_freq()
        
        # Memory stats
        memory = psutil.virtual_memory()
        swap = psutil.swap_memory()
        
        # Disk stats
        disk = psutil.disk_usage('/')
        disk_io = psutil.disk_io_counters()
        
        # Network stats
        network = psutil.net_io_counters()
        
        # Load average
        load_avg = os.getloadavg() if hasattr(os, 'getloadavg') else [0, 0, 0]
        
        return {
            "cpu": {
                "percent": cpu_percent,
                "count": cpu_count,
                "frequency": {
                    "current": cpu_freq.current if cpu_freq else 0,
                    "min": cpu_freq.min if cpu_freq else 0,
                    "max": cpu_freq.max if cpu_freq else 0
                },
                "load_average": {
                    "1min": load_avg[0],
                    "5min": load_avg[1],
                    "15min": load_avg[2]
                }
            },
            "memory": {
                "total": memory.total,
                "available": memory.available,
                "used": memory.used,
                "percent": memory.percent,
                "swap": {
                    "total": swap.total,
                    "used": swap.used,
                    "free": swap.free,
                    "percent": swap.percent
                }
            },
            "disk": {
                "total": disk.total,
                "used": disk.used,
                "free": disk.free,
                "percent": (disk.used / disk.total) * 100,
                "io": {
                    "read_count": disk_io.read_count if disk_io else 0,
                    "write_count": disk_io.write_count if disk_io else 0,
                    "read_bytes": disk_io.read_bytes if disk_io else 0,
                    "write_bytes": disk_io.write_bytes if disk_io else 0
                }
            },
            "network": {
                "bytes_sent": network.bytes_sent,
                "bytes_recv": network.bytes_recv,
                "packets_sent": network.packets_sent,
                "packets_recv": network.packets_recv
            }
        }
    except Exception as e:
        logger.error(f"Failed to get system stats: {e}")
        return {}

@router.get("/system")
async def get_system_performance():
    """Get comprehensive system performance metrics.

    NOTE on scope: this process runs inside the `backend` container. Docker
    does not namespace /proc/stat or /proc/meminfo, so `system.cpu` and
    `system.memory` reflect the WHOLE HOST machine (every container plus the
    host OS) — not just this container's own usage or its resource limit.
    `system.network` IS container-scoped (Docker gives each container its own
    network namespace), so it only counts this container's own traffic, not
    total host traffic. `system.disk` reflects the container's root
    filesystem, which is backed by the host's Docker storage partition.
    `container` (below) is the accurate, cgroup-based counterpart: this
    container's own CPU/memory usage and limit, independent of what else is
    running on the host (None on cgroup v1 hosts).
    """
    try:
        timestamp = time.time()

        system_stats = get_system_stats()
        gpu_stats = get_gpu_stats()
        docker_stats = get_docker_stats()
        container_stats = get_container_stats()

        return JSONResponse({
            "timestamp": timestamp,
            "system": system_stats,
            "container": container_stats,
            "gpu": gpu_stats,
            "docker": docker_stats,
            "status": "success"
        })
    except Exception as e:
        logger.error(f"Failed to get system performance: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get system performance: {str(e)}")

@router.get("/gpu")
async def get_gpu_performance():
    """Get GPU performance metrics."""
    try:
        timestamp = time.time()
        gpu_stats = get_gpu_stats()
        
        return JSONResponse({
            "timestamp": timestamp,
            "gpu": gpu_stats,
            "status": "success"
        })
    except Exception as e:
        logger.error(f"Failed to get GPU performance: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get GPU performance: {str(e)}")

@router.get("/docker")
async def get_docker_performance():
    """Get Docker container performance metrics."""
    try:
        timestamp = time.time()
        docker_stats = get_docker_stats()
        
        return JSONResponse({
            "timestamp": timestamp,
            "docker": docker_stats,
            "status": "success"
        })
    except Exception as e:
        logger.error(f"Failed to get Docker performance: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get Docker performance: {str(e)}")

@router.get("/summary")
async def get_performance_summary():
    """Get a summary of key performance metrics."""
    try:
        timestamp = time.time()
        
        system_stats = get_system_stats()
        gpu_stats = get_gpu_stats()
        docker_stats = get_docker_stats()
        
        # Calculate summary metrics
        summary = {
            "timestamp": timestamp,
            "cpu_usage": system_stats.get("cpu", {}).get("percent", 0),
            "memory_usage": system_stats.get("memory", {}).get("percent", 0),
            "disk_usage": system_stats.get("disk", {}).get("percent", 0),
            "gpu_count": len(gpu_stats),
            "gpu_usage": gpu_stats[0].get("gpu_utilization", 0) if gpu_stats else 0,
            "gpu_memory_usage": gpu_stats[0].get("memory_utilization", 0) if gpu_stats else 0,
            "container_count": len(docker_stats),
            "load_average": system_stats.get("cpu", {}).get("load_average", {}).get("1min", 0),
            "status": "healthy" if system_stats.get("cpu", {}).get("percent", 0) < 90 else "warning"
        }
        
        return JSONResponse(summary)
    except Exception as e:
        logger.error(f"Failed to get performance summary: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get performance summary: {str(e)}")

@router.get("/health")
async def get_performance_health():
    """Get performance health status."""
    try:
        timestamp = time.time()
        
        system_stats = get_system_stats()
        gpu_stats = get_gpu_stats()
        
        # Health checks
        cpu_usage = system_stats.get("cpu", {}).get("percent", 0)
        memory_usage = system_stats.get("memory", {}).get("percent", 0)
        disk_usage = system_stats.get("disk", {}).get("percent", 0)
        gpu_usage = gpu_stats[0].get("gpu_utilization", 0) if gpu_stats else 0
        gpu_temp = gpu_stats[0].get("temperature", 0) if gpu_stats else 0
        
        health_status = "healthy"
        warnings = []
        
        if cpu_usage > 90:
            health_status = "critical"
            warnings.append(f"High CPU usage: {cpu_usage:.1f}%")
        elif cpu_usage > 80:
            health_status = "warning"
            warnings.append(f"Elevated CPU usage: {cpu_usage:.1f}%")
            
        if memory_usage > 90:
            health_status = "critical"
            warnings.append(f"High memory usage: {memory_usage:.1f}%")
        elif memory_usage > 80:
            health_status = "warning"
            warnings.append(f"Elevated memory usage: {memory_usage:.1f}%")
            
        if disk_usage > 90:
            health_status = "critical"
            warnings.append(f"High disk usage: {disk_usage:.1f}%")
        elif disk_usage > 80:
            health_status = "warning"
            warnings.append(f"Elevated disk usage: {disk_usage:.1f}%")
            
        return JSONResponse({
            "timestamp": timestamp,
            "status": health_status,
            "warnings": warnings,
            "metrics": {
                "cpu_usage": cpu_usage,
                "memory_usage": memory_usage,
                "disk_usage": disk_usage,
                "gpu_usage": gpu_usage,
                "gpu_temperature": gpu_temp
            }
        })
    except Exception as e:
        logger.error(f"Failed to get performance health: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get performance health: {str(e)}")
