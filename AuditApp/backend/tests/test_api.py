from app import models


def test_register_and_login(client):
    resp = client.post(
        "/api/auth/register",
        json={
            "email": "newuser@harvest.com",
            "password": "password123",
            "name": "New User",
            "designation": "Auditor",
            "role": "auditor",
            "location": "Both",
        },
    )
    assert resp.status_code == 201

    login = client.post(
        "/api/auth/login",
        json={"email": "newuser@harvest.com", "password": "password123"},
    )
    assert login.status_code == 200
    data = login.json()
    assert data["token_type"] == "bearer"
    assert data["role"] == "auditor"
    assert "access_token" in data


def test_teacher_cannot_see_draft_observations(client, auth_header):
    auditor_headers = auth_header(client, "auditor@harvest.com")
    teacher_headers = auth_header(client, "teacher@harvest.com")

    create = client.post(
        "/api/observations",
        json={
            "school": "Kodathi",
            "subject": "Science",
            "grade": "Grade 4",
            "section": "Section B",
            "teacher_id": 3,
            "p11": 2,
            "p12": 2,
            "p21": 2,
            "p31": 2,
            "p32": 2,
            "p33": 2,
            "p34": 2,
            "infrastructure_issues": "",
            "other_issues": "",
            "objective_observations": "Draft notes",
        },
        headers=auditor_headers,
    )
    assert create.status_code == 200
    assert create.json()["is_draft"] is True

    teacher_view = client.get("/api/observations/teacher/3", headers=teacher_headers)
    assert teacher_view.status_code == 200
    assert teacher_view.json() == []


def test_sme_cannot_access_unassigned_teacher(client, auth_header):
    sme_headers = auth_header(client, "sme@harvest.com")
    resp = client.get("/api/observations/teacher/4", headers=sme_headers)
    assert resp.status_code == 403


def test_only_creator_can_finalise_draft(client, auth_header):
    creator_headers = auth_header(client, "auditor@harvest.com")
    other_headers = auth_header(client, "auditor2@harvest.com")

    obs = client.post(
        "/api/observations",
        json={
            "school": "Kodathi",
            "subject": "English",
            "grade": "Grade 3",
            "section": "Section A",
            "teacher_id": 3,
            "p11": 4,
            "p12": 4,
            "p21": 4,
            "p31": 4,
            "p32": 4,
            "p33": 4,
            "p34": 4,
            "infrastructure_issues": "",
            "other_issues": "",
            "objective_observations": "Excellent class",
        },
        headers=creator_headers,
    )
    obs_id = obs.json()["id"]

    denied = client.post(f"/api/observations/{obs_id}/finalise", headers=other_headers)
    assert denied.status_code == 403

    allowed = client.post(f"/api/observations/{obs_id}/finalise", headers=creator_headers)
    assert allowed.status_code == 200
    assert allowed.json()["is_draft"] is False


def test_multiple_images_per_observation(client, auth_header):
    headers = auth_header(client, "auditor@harvest.com")

    obs = client.post(
        "/api/observations",
        json={
            "school": "Kodathi",
            "subject": "Math",
            "grade": "Grade 6",
            "section": "Section C",
            "teacher_id": 3,
            "p11": 3,
            "p12": 3,
            "p21": 3,
            "p31": 3,
            "p32": 3,
            "p33": 3,
            "p34": 3,
            "infrastructure_issues": "",
            "other_issues": "",
            "objective_observations": "Notes",
        },
        headers=headers,
    )
    obs_id = obs.json()["id"]

    for name in ("photo1.jpg", "photo2.png"):
        upload = client.post(
            f"/api/observations/{obs_id}/images",
            headers=headers,
            files={"file": (name, b"fake-image-bytes", "image/jpeg")},
        )
        assert upload.status_code == 200

    history = client.get("/api/observations/teacher/3", headers=headers)
    latest = history.json()[0]
    assert len(latest["images"]) == 2


def test_dashboard_filters_by_sme_assignment(client, auth_header):
    auditor_headers = auth_header(client, "auditor@harvest.com")
    sme_headers = auth_header(client, "sme@harvest.com")

    client.post(
        "/api/observations",
        json={
            "school": "Kodathi",
            "subject": "Math",
            "grade": "Grade 5",
            "section": "Section A",
            "teacher_id": 3,
            "p11": 3,
            "p12": 3,
            "p21": 3,
            "p31": 3,
            "p32": 3,
            "p33": 3,
            "p34": 3,
            "infrastructure_issues": "",
            "other_issues": "",
            "objective_observations": "",
        },
        headers=auditor_headers,
    )

    client.post(
        "/api/observations",
        json={
            "school": "Attibele",
            "subject": "Science",
            "grade": "Grade 4",
            "section": "Section A",
            "teacher_id": 4,
            "p11": 2,
            "p12": 2,
            "p21": 2,
            "p31": 2,
            "p32": 2,
            "p33": 2,
            "p34": 2,
            "infrastructure_issues": "",
            "other_issues": "",
            "objective_observations": "",
        },
        headers=auditor_headers,
    )

    sme_dashboard = client.get("/api/dashboard?location=Kodathi", headers=sme_headers)
    assert sme_dashboard.status_code == 200
    teacher_ids = {row["teacher_id"] for row in sme_dashboard.json()}
    assert 3 in teacher_ids
    assert 4 not in teacher_ids
