
const { readIncidents, saveIncidents } = require("./store");

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    },
    body: JSON.stringify(body),
  };
}

exports.submitHandler = async (event) => {
  try {
    const payload = JSON.parse(event.body || "{}");

    if (
      !payload.title ||
      !payload.city ||
      !payload.description ||
      !Array.isArray(payload.coordinates) ||
      payload.coordinates.length !== 2
    ) {
      return response(400, {
        error: "Missing required report fields",
      });
    }

    const incidents = readIncidents();

    const incident = {
      ...payload,
      id: `fl-api-${Date.now().toString(36)}`,
      timestamp: Date.now(),
      reportedAt: "Just now",
      status: "active",
      corroborationCount: 0,
      corroborationIds: [],
      source: "AWS SAM local demo",
    };

    incidents.unshift(incident);
    saveIncidents(incidents);

    return response(201, incident);
  } catch (error) {
    console.error("Failed to save report:", error);

    return response(500, {
      error: "Could not save report",
    });
  }
};

exports.corroborateHandler = async (event) => {
  try {
    const route = event.rawPath || event.path || "";
    const incidentId = decodeURIComponent(
      event.pathParameters?.id ||
      event.pathParameters?.incidentId ||
      (route.match(/\/(?:reports|incidents)\/([^/]+)\/corroborate/) || [])[1] ||
      ""
    );

    let payload = {};
    try {
      payload = JSON.parse(event.body || "{}");
    } catch {
      return response(400, { error: "Invalid JSON request body" });
    }

    const voterId = String(payload.voterId || "").trim();
    if (!voterId) {
      return response(400, {
        error: "voterId is required to record a corroboration",
      });
    }

    const incidents = readIncidents();
    const incident = incidents.find((i) => i.id === incidentId);

    if (!incident) {
      return response(404, { error: "Incident not found" });
    }

    incident.corroborationIds = incident.corroborationIds || [];
    if (incident.corroborationIds.includes(voterId)) {
      return response(409, {
        error: "Incident not found or this voter already corroborated it",
      });
    }

    incident.corroborationIds.push(voterId);
    incident.corroborationCount = (Number(incident.corroborationCount) || 0) + 1;
    saveIncidents(incidents);

    return response(200, incident);
  } catch (error) {
    console.error("Failed to corroborate report:", error);
    return response(500, {
      error: "Could not record corroboration",
      details: error.message,
    });
  }
};
