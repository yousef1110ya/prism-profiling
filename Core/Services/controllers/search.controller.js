import axios from "axios";
import is_following from "../helpers/is_following.helper.js"; // adjust path as needed
import is_member from "../helpers/is_member.helper.js";
// normalize ES _source into your app's user schema
function normalizeUser(esUser) {
  return {
    id: esUser.id,
    username: esUser.username,
    name: esUser.name,
    avatar: esUser.avatar,
    bio: esUser.bio || "",
    isPrivate: esUser.is_private === "1",
    personalInfo: esUser.personal_info,
  };
}

function normalizeGroup(esGroup) {
  return {
    id: esGroup.id,
    name: esGroup.name,
    privacy: esGroup.privacy || "public",
    bio: esGroup.bio || "",
    avatar: esGroup.avatar || null,
  };
}

export async function user(req, res) {
  try {
    const { q, page = 1, size = 10 } = req.query; // pagination + search string
    console.log(req.query);
    const userId = req.user.id; // current logged-in user

    if (!q) {
      return res.status(400).json({ error: "Missing search query" });
    }

    // calculate pagination offsets
    const from = (page - 1) * size;

    // 1. Query Elasticsearch with wildcard across multiple fields
    const esResponse = await axios.post("http://localhost:9200/users/_search", {
      from,
      size,
      query: {
        bool: {
          should: [
            { wildcard: { name: `*${q}*` } },
            { wildcard: { username: `*${q}*` } },
            { wildcard: { bio: `*${q}*` } },
          ],
        },
      },
    });

    const hits = esResponse.data.hits?.hits || [];

    // 2. Normalize and enrich with is_following
    const users = await Promise.all(
      hits.map(async (hit) => {
        const normalized = normalizeUser(hit._source);

        const following = await is_following(normalized.id, userId);

        return {
          ...normalized,
          is_following: following || false,
        };
      }),
    );

    // 3. Send paginated response
    return res.json({
      users,
      pagination: {
        page: Number(page),
        size: Number(users.length),
        total: esResponse.data.hits.total.value,
      },
    });
  } catch (err) {
    console.error("Elasticsearch error:", err.message);
    return res.status(500).json({ error: "Search failed" });
  }
}

export async function group(req, res) {
  try {
    const { q, page = 1, size = 10 } = req.query; // pagination + search string
    console.log(req.query);
    const userId = req.user.id; // current logged-in user

    if (!q) {
      return res.status(400).json({ error: "Missing search query" });
    }

    // calculate pagination offsets
    const from = (page - 1) * size;

    // 1. Query Elasticsearch with wildcard across multiple fields
    const esResponse = await axios.post(
      "http://localhost:9200/groups/_search",
      {
        from,
        size,
        query: {
          bool: {
            should: [
              { wildcard: { name: `*${q}*` } },
              { wildcard: { bio: `*${q}*` } },
            ],
          },
        },
      },
    );

    const hits = esResponse.data.hits?.hits || [];

    // 2. Normalize and enrich with is_following
    const groups = await Promise.all(
      hits.map(async (hit) => {
        const normalized = normalizeGroup(hit._source);

        const member = await is_member(userId, normalized.id);

        return {
          ...normalized,
          is_member: member || false,
        };
      }),
    );

    // 3. Send paginated response
    return res.json({
      groups,
      pagination: {
        page: Number(page),
        size: Number(groups.length),
        total: esResponse.data.hits.total.value,
      },
    });
  } catch (err) {
    console.error("Elasticsearch error:", err.message);
    return res.status(500).json({ error: "Search failed" });
  }
}
