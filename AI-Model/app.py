
from flask import Flask, request, jsonify
from transformers import CLIPProcessor, CLIPModel
from keybert import KeyBERT
import requests
from PIL import Image
from io import BytesIO
from collections import defaultdict

app = Flask(__name__)

# Load models
clip_model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
clip_processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
kw_model = KeyBERT()


def download_image(url):
    response = requests.get(url)
    img = Image.open(BytesIO(response.content)).convert("RGB")
    return img


def extract_text_tags(text, top_n=5):
    keywords = kw_model.extract_keywords(text, top_n=top_n)
    return [{"tag": kw[0], "score": round(kw[1], 2)} for kw in keywords]


def extract_image_tags(image, candidate_tags):
    inputs = clip_processor(text=candidate_tags, images=image, return_tensors="pt", padding=True)
    outputs = clip_model(**inputs)
    scores = outputs.logits_per_image.softmax(dim=1).tolist()[0]
    return [{"tag": tag, "score": round(score, 2)} for tag, score in zip(candidate_tags, scores)]


def merge_tag_scores(text_tags, image_tags):
    scores = defaultdict(list)
    for tag in text_tags + image_tags:
        scores[tag["tag"]].append(tag["score"])
    return [{"tag": tag, "score": round(sum(vals) / len(vals), 2)} for tag, vals in scores.items()]


@app.route("/generate-tags", methods=["POST"])
def generate_tags():
    data = request.get_json()
    text = data.get("text")
    image_url = data.get("media_url")

    if not text or not image_url:
        return jsonify({"error": "Missing 'text' or 'media_url' in request"}), 400

    try:
        image = download_image(image_url)
        text_tags = extract_text_tags(text)
        candidate_tags = [t["tag"] for t in text_tags]
        image_tags = extract_image_tags(image, candidate_tags)
        final_tags = merge_tag_scores(text_tags, image_tags)

        return jsonify({"tags": final_tags})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
