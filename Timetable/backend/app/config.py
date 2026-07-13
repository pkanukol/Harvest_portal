from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = ""
    SECRET_KEY: str = "harvest_timetable_secret_change_me_in_prod_1234567890"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440

    SUPABASE_URL: str = "https://aouvxdfamzprykezeovl.supabase.co"
    SUPABASE_ANON_KEY: str = "sb_publishable_rIfo8DPrbyOmU006ii3onw_sDRWJwvE"
    PORTAL_URL: str = "http://localhost:3000/portal/login.html"

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
