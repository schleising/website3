from ipaddress import ip_address

from fastapi import Request


def is_private_or_local_ip(host: str) -> bool:
    candidate = host.strip()
    if candidate in {"", "unknown", "localhost"}:
        return True

    try:
        parsed = ip_address(candidate)
    except ValueError:
        return False

    return parsed.is_private or parsed.is_loopback or parsed.is_link_local


def forwarded_client_ip(x_real_ip: str, x_forwarded_for: str) -> str:
    real_ip = x_real_ip.strip()
    if real_ip != "":
        return real_ip

    return x_forwarded_for.split(",", maxsplit=1)[0].strip()


def resolve_client_ip(
    peer_host: str,
    x_real_ip: str = "",
    x_forwarded_for: str = "",
    trusted_proxies: list[str] | None = None,
) -> str:
    """Return the nginx client IP when the TCP peer is the Docker/Mac proxy."""

    peer = peer_host.strip()
    forwarded = forwarded_client_ip(x_real_ip, x_forwarded_for)
    trusted_peers = trusted_proxies or []
    peer_is_trusted = is_private_or_local_ip(peer) or peer in trusted_peers

    if forwarded != "" and peer_is_trusted:
        return forwarded

    if peer != "":
        return peer

    return "unknown"


def client_ip_for_request(
    request: Request, trusted_proxies: list[str] | None = None
) -> str:
    peer_host = ""
    if request.client is not None:
        peer_host = request.client.host.strip()

    return resolve_client_ip(
        peer_host,
        x_real_ip=request.headers.get("x-real-ip", ""),
        x_forwarded_for=request.headers.get("x-forwarded-for", ""),
        trusted_proxies=trusted_proxies,
    )
