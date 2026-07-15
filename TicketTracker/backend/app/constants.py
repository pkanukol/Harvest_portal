CATEGORIES = sorted(["Admin", "Curriculum", "Infrastructure", "HR", "DLP", "Transport", "Stores", "Admission"])
LOCATIONS = ["Kodathi", "Attibele"]

TICKET_ATTENTION_HOURS = 48

SUPER_ADMIN_EMAILS = {
    "abhinav_g@harvestinternationalschool.in",
    "guru@harvestinternationalschool.in",
    "pavani.k@harvestinternationalschool.in",
    "sumanth@harvestinternationalschool.in",
}

PRINCIPAL_BY_LOCATION = {
    "Kodathi": {"name": "Principal - Kodathi", "email": "principal.kodathi@harvestinternationalschool.in"},
    "Attibele": {"name": "Principal - Attibele", "email": "principal.attibele@harvestinternationalschool.in"},
}

MANAGING_DIRECTOR = {"name": "Managing Director", "email": "abhinav_g@harvestinternationalschool.in"}

# Fills in Order Details (vendor, actual cost, delivery date, tracking) once a Stores
# requisition is Approved - same contact for both locations.
STORES_PROCUREMENT_CONTACT = {"name": "Trinadh", "email": "trinadha@harvestinternationalschool.in"}

_ANKITA = {"name": "Ankita K", "email": "ankita.k@harvestinternationalschool.in"}
_HR_KODATHI = {"name": "HR - Kodathi", "email": "hr@harvestinternationalschool.in"}
_HR_ATTIBELE = {"name": "HR - Attibele", "email": "hr.attibele@harvestinternationalschool.in"}
_DLP_TO = [
    {"name": "Pavani Kanukollu", "email": "pavani.k@harvestinternationalschool.in"},
    {"name": "Guru", "email": "guru@harvestinternationalschool.in"},
]
_CURRICULUM_TO = [
    {"name": "CH Vinny", "email": "chvinny@harvestinternationalschool.in"},
    {"name": "Chitra", "email": "chitra@harvestinternationalschool.in"},
]
_TRANSPORT_KODATHI = {"name": "Transport - Kodathi", "email": "transport@harvestinternationalschool.in"}
_TRANSPORT_ATTIBELE = {"name": "Transport - Attibele", "email": "transport.attibele@harvestinternationalschool.in"}
_SATHISH = {"name": "Sathish", "email": "sathish@harvestinternationalschool.in"}
_SURESH = {"name": "Suresh", "email": "suresh@harvestinternationalschool.in"}
_ADMISSIONS_KODATHI = [
    {"name": "Admissions", "email": "admissions@harvestinternationalschool.in"},
    {"name": "Admissions Internal", "email": "admissions-internal@harvestinternationalschool.in"},
]
_ADMISSIONS_ATTIBELE = [{"name": "Admissions", "email": "admissions@harvestinnovationcampus.com"}]

# category -> location -> {"to": [{"name","email"}, ...], "cc": [...]}
# "to" recipients can close/approve a ticket; "cc" recipients are notified only.
CATEGORY_ROUTING = {
    "Admin": {
        "Kodathi": {"to": [_ANKITA], "cc": [PRINCIPAL_BY_LOCATION["Kodathi"]]},
        "Attibele": {"to": [_ANKITA], "cc": [PRINCIPAL_BY_LOCATION["Attibele"]]},
    },
    "HR": {
        "Kodathi": {"to": [_HR_KODATHI], "cc": []},
        "Attibele": {"to": [_HR_ATTIBELE], "cc": []},
    },
    "DLP": {
        "Kodathi": {"to": _DLP_TO, "cc": []},
        "Attibele": {"to": _DLP_TO, "cc": []},
    },
    "Curriculum": {
        "Kodathi": {"to": _CURRICULUM_TO, "cc": []},
        "Attibele": {"to": _CURRICULUM_TO, "cc": []},
    },
    "Transport": {
        "Kodathi": {"to": [_TRANSPORT_KODATHI], "cc": []},
        "Attibele": {"to": [_TRANSPORT_ATTIBELE], "cc": []},
    },
    "Infrastructure": {
        "Kodathi": {"to": [_SATHISH], "cc": []},
        "Attibele": {"to": [_SURESH], "cc": []},
    },
    "Admission": {
        "Kodathi": {"to": _ADMISSIONS_KODATHI, "cc": []},
        "Attibele": {"to": _ADMISSIONS_ATTIBELE, "cc": []},
    },
    # Stores (inventory requisition) routes to that location's Principal (L1) and the
    # Managing Director (L2) - either can approve/reject independently, no fixed order.
    "Stores": {
        "Kodathi": {"to": [PRINCIPAL_BY_LOCATION["Kodathi"], MANAGING_DIRECTOR], "cc": []},
        "Attibele": {"to": [PRINCIPAL_BY_LOCATION["Attibele"], MANAGING_DIRECTOR], "cc": []},
    },
}
