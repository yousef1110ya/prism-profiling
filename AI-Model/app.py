from flask import Flask, request, jsonify
from keybert import KeyBERT

app = Flask(__name__)
kw_model = KeyBERT('paraphrase-multilingual-MiniLM-L12-v2')

@app.route('/extract_keywords', methods=['POST'])
def extract_keywords():
    data = request.json
    text = data.get("text")
    if text:
        keywords = kw_model.extract_keywords(text)
        return jsonify({"keywords": keywords})
    return jsonify({"error": "No text provided"}), 400

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=5000)
