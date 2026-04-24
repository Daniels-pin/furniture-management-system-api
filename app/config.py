import os
from dotenv import load_dotenv

# load variables from .env file
load_dotenv()

def _getenv_stripped(key: str, default: str | None = None) -> str | None:
    val = os.getenv(key)
    if val is None:
        return default
    val = val.strip()
    return val if val != "" else default

# get database connection string
DATABASE_URL = _getenv_stripped("DATABASE_URL")

# jwt settings
SECRET_KEY = _getenv_stripped("SECRET_KEY")
# Default to HS256 to reduce production misconfig footguns.
ALGORITHM = _getenv_stripped("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(_getenv_stripped("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))

if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY is not set (required for JWT signing)")
