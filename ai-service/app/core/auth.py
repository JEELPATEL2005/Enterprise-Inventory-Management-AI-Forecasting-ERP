import json
from typing import List, Optional
from fastapi import Header, HTTPException, status
from pydantic import BaseModel
from app.config import settings

class AuthenticatedUser(BaseModel):
    id: str
    name: str = "User"
    email: str = ""
    role: str = "EMPLOYEE"
    assigned_warehouses: List[str] = []

async def verify_internal_service(
    x_internal_service_key: Optional[str] = Header(None, alias="X-Internal-Service-Key"),
    x_user_id: Optional[str] = Header(None, alias="X-User-Id"),
    x_user_name: Optional[str] = Header("User", alias="X-User-Name"),
    x_user_email: Optional[str] = Header("", alias="X-User-Email"),
    x_user_role: Optional[str] = Header("EMPLOYEE", alias="X-User-Role"),
    x_assigned_warehouses: Optional[str] = Header("[]", alias="X-Assigned-Warehouses"),
) -> AuthenticatedUser:
    """
    Enforces that requests to the AI microservice originate exclusively from
    the authenticated Node.js Express ERP gateway via a pre-shared secret.
    """
    if not x_internal_service_key or x_internal_service_key != settings.INTERNAL_SERVICE_KEY:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Forbidden: Invalid or missing internal service authorization.",
        )

    if not x_user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User identity context (X-User-Id) is required.",
        )

    # Parse assigned warehouses safely
    assigned_whs: List[str] = []
    if x_assigned_warehouses:
        try:
            parsed = json.loads(x_assigned_warehouses)
            if isinstance(parsed, list):
                assigned_whs = [str(item) for item in parsed]
        except Exception:
            # Fallback to comma separated
            assigned_whs = [w.strip() for w in x_assigned_warehouses.split(",") if w.strip()]

    return AuthenticatedUser(
        id=x_user_id,
        name=x_user_name or "User",
        email=x_user_email or "",
        role=(x_user_role or "EMPLOYEE").upper(),
        assigned_warehouses=assigned_whs,
    )

