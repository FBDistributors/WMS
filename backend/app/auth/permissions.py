ROLE_PERMISSIONS: dict[str, list[str]] = {
    "admin": [
        "admin:access",
        "products:read",
        "products:write",
        "inventory:read",
        "inventory:write",
        "picking:read",
        "picking:write",
        "users:manage",
    ],
    "manager": [
        "admin:access",
        "products:read",
        "inventory:read",
        "picking:read",
    ],
    "picker": [
        "picking:read",
        "picking:write",
    ],
}
