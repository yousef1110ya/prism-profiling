import axios from "axios";
import is_following from "../helpers/is_following.helper.js"; // adjust path as needed
import is_member from "../helpers/is_member.helper.js";
import get_user from "../helpers/get_user.helper.js";
import { driver } from "../neo4j/Driver.js";

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
function normalizePost(hit, user, following = false) {
  const src = hit._source;
  return {
    id: Number(hit._id),
    text: src.text,
    group_id: src.group_id,
    media: src.media || [],
    privacy: src.privacy,
    created_at: src.created_at,
    post_type: "post",
    user: {
      ...user,
      is_following: following,
    },
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

export async function post(req, res) {
  try {
    const { q, page = 1, size = 10 } = req.query;
    const userId = req.user.id;
    let esResponse;
    if (!q) {
      return res.status(400).json({ error: "Missing search query" });
    }
    const from = (page - 1) * size;
    if (q.startsWith("#")) {
      console.log("First character is #", q);

      esResponse = await axios.post("http://localhost:9200/posts/_search", {
        from,
        size,
        query: {
          match: {
            text: q,
          },
        },
      });
    } else {
      esResponse = await axios.post("http://localhost:9200/posts/_search", {
        from,
        size,
        query: {
          bool: {
            must: [
              {
                wildcard: {
                  text: `*${q}*`,
                },
              },
            ],
            filter: [
              { term: { privacy: "public" } }, // only public posts
            ],
          },
        },
        sort: [{ created_at: { order: "desc" } }],
      });
    }
    const hits = esResponse.data.hits?.hits || [];

    const posts = await Promise.all(
      hits.map(async (hit) => {
        const src = hit._source;

        // check follow state
        const following = await is_following(src.user.id, userId);

        // enrich user if needed
        let userData = await get_user(src.user.id);

        return normalizePost(hit, userData, following);
      }),
    );

    return res.json({
      posts,
      pagination: {
        page: Number(page),
        size: Number(posts.length),
        total: esResponse.data.hits.total.value,
      },
    });
  } catch (err) {
    console.error("Elasticsearch error:", err.message);
    return res.status(500).json({ error: "Search failed" });
  }
}

export async function hashtag(req, res) {
  const session = driver.session();
  try {
    const { q, page = 1, pageSize = 10 } = req.query;
    const skip = (page - 1) * pageSize;

    const result = await session.run(
      `
      MATCH (h:Hashtag)<-[:TAGGED_WITH]-(p:Post)
      WHERE h.name CONTAINS $searchString
      WITH h, COUNT(p) AS postCount,
           CASE WHEN h.name = $searchString THEN 0 ELSE 1 END AS exactMatchPriority
      RETURN h.name AS hashtag, postCount
      ORDER BY exactMatchPriority ASC, postCount DESC
      SKIP toInteger($skip)
      LIMIT toInteger($limit)
      `,
      { searchString: q, skip: parseInt(skip), limit: parseInt(pageSize) },
    );

    const hashtags = result.records.map((record) => ({
      hashtag: record.get("hashtag"),
      postCount: record.get("postCount").toNumber(),
    }));
    return res.json({
      page: Number(page),
      pageSize: Number(pageSize),
      results: hashtags,
    });
  } catch (error) {
    console.error("error in finding hastags>", error);
  } finally {
    await session.close();
  }
}
