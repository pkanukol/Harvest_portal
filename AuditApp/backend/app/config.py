from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite:///./audit.db"
    SECRET_KEY: str = "harvest_secret_key_change_me_in_prod_1234567890"
    ALGORITHM: str = "HS256"

    ANTHROPIC_API_KEY: str = ""
    # Where email notifications send people. The standalone app is now embedded
    # in this Netlify shell as the actual front door, so this is a flat link,
    # not a deep link into a specific page.
    APP_URL: str = "https://his-academy360.netlify.app"
    # Where the "View report / Open" buttons in notification emails point — the class
    # observation module in the Elevate360 ERP. Its own setting so a stale APP_URL env var
    # (which had caused wrong email links before) can't override it.
    CLASSOBS_URL: str = "https://elevate360india.com/classobs"

    RESEND_API_KEY: str = ""
    RESEND_FROM_EMAIL: str = ""
    #SMTP_HOST: str = "smtp.gmail.com"
    #SMTP_PORT: int = 587
    #SMTP_USERNAME: str = ""
    #SMTP_PASSWORD: str = ""
    #SMTP_FROM_EMAIL: str = ""

    SUPABASE_URL: str = "https://aouvxdfamzprykezeovl.supabase.co"
    SUPABASE_ANON_KEY: str = "sb_publishable_rIfo8DPrbyOmU006ii3onw_sDRWJwvE"

    model_config = {"env_file": ".env", "extra": "ignore"}

settings = Settings()
