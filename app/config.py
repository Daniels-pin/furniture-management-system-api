import os
from dotenv import load_dotenv

# load variables from .env file
load_dotenv()

# get database connection string
DATABASE_URL = os.getenv("DATABASE_URL")

# jwt settings
SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = os.getenv("ALGORITHM")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES"))
