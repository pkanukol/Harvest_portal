CATEGORIES = ["Admin", "Curriculum", "Infrastructure", "HR", "DLP"]

# Category -> responsible person. All categories point to Pavani for now;
# update per-category once other owners are identified.
_PAVANI = {
    "name": "Pavani Kanukollu",
    "email": "pavani.k@harvestinternationalschool.in",
    "whatsapp": "",  # set per-person WhatsApp number (with country code) once available
}

CATEGORY_RESPONSIBLE = {category: _PAVANI for category in CATEGORIES}

TICKET_ATTENTION_HOURS = 48
