#!/usr/bin/env python3
"""
🎤 Alfred Whisper Server
Servidor local para transcrição de voz usando faster-whisper

Uso:
    pip install faster-whisper flask
    python whisper-server.py
"""

from flask import Flask, request, jsonify
from faster_whisper import WhisperModel
import tempfile
import os
import logging

# Configuração
import os
import site

# Inicializar logger ANTES de usar
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def add_nvidia_paths():
    """Adiciona DLLs da NVIDIA ao PATH automaticamente"""
    try:
        site_packages = site.getsitepackages()
        for sp in site_packages:
            nvidia_path = os.path.join(sp, 'nvidia')
            if os.path.exists(nvidia_path):
                logger.info(f"🔍 Procurando DLLs em: {nvidia_path}")
                for root, dirs, files in os.walk(nvidia_path):
                    if 'bin' in dirs:
                        bin_path = os.path.join(root, 'bin')
                        if hasattr(os, 'add_dll_directory'):
                            os.add_dll_directory(bin_path)
                        os.environ['PATH'] = bin_path + os.pathsep + os.environ['PATH']
                        logger.info(f"📚 DLLs NVIDIA adicionadas: {bin_path}")
    except Exception as e:
        logger.warning(f"⚠️ Erro ao adicionar paths NVIDIA: {e}")

add_nvidia_paths()

MODEL_SIZE = "medium"  # tiny, base, small, medium, large (medium = maior precisão)

app = Flask(__name__)
# logging init removido daqui pois já foi feito acima

# Tentar carregar na GPU, fallback para CPU
import wave

def create_dummy_wav():
    """Cria um arquivo WAV vazio para teste"""
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    with wave.open(tmp.name, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(b'\x00' * 16000) # 1 seg de silêncio
    return tmp.name

try:
    logger.info(f"🔄 Tentando carregar modelo '{MODEL_SIZE}' na GPU (cuda, float16)...")
    model = WhisperModel(MODEL_SIZE, device="cuda", compute_type="float16")
    
    # Warm-up para testar se as DLLs do CUDA estão presentes
    logger.info("🧪 Testando inferência na GPU...")
    dummy_wav = create_dummy_wav()
    try:
        list(model.transcribe(dummy_wav)) # Forçar execução
        DEVICE = "cuda"
        logger.info("✅ Modelo carregado e testado na GPU com sucesso!")
    finally:
        if os.path.exists(dummy_wav):
            os.remove(dummy_wav)
            
except Exception as e:
    logger.warning(f"⚠️ Não foi possível usar GPU (provável falta de DLLs cuBLAS/cuDNN): {e}")
    logger.info(f"🔄 Carregando modelo '{MODEL_SIZE}' na CPU (int8)...")
    model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8")
    DEVICE = "cpu"
logger.info("✅ Modelo Whisper carregado!")


@app.route('/health', methods=['GET'])
def health():
    """Endpoint de health check"""
    return jsonify({"status": "ok", "model": MODEL_SIZE})


@app.route('/transcribe', methods=['POST'])
def transcribe():
    """
    Transcreve um arquivo de áudio
    
    Espera:
        - Arquivo de áudio no campo 'audio'
        - Opcional: 'language' (padrão: 'pt')
    
    Retorna:
        - { "text": "transcrição", "language": "pt", "segments": [...] }
    """
    try:
        # Verificar se há arquivo
        if 'audio' not in request.files:
            return jsonify({"error": "Nenhum arquivo de áudio enviado"}), 400
        
        audio_file = request.files['audio']
        language = request.form.get('language', 'pt')
        
        # Salvar temporariamente
        with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as tmp:
            audio_file.save(tmp.name)
            tmp_path = tmp.name
        
        try:
            # Transcrever
            logger.info(f"🎤 Transcrevendo áudio ({language})...")
            
            segments, info = model.transcribe(
                tmp_path,
                language=language,
                beam_size=1,
                vad_filter=True,  # Remove silêncio
                initial_prompt="Alfred, toque música. Avenged Sevenfold, Guns N' Roses, Metallica, Iron Maiden, Seize the Day, tocar, pausa, pula, parar.",
                vad_parameters=dict(
                    min_silence_duration_ms=500,
                    threshold=0.5
                )
            )
            
            # Concatenar texto
            text_parts = []
            segment_list = []
            
            for segment in segments:
                text_parts.append(segment.text.strip())
                segment_list.append({
                    "start": segment.start,
                    "end": segment.end,
                    "text": segment.text.strip()
                })
            
            full_text = " ".join(text_parts)
            
            logger.info(f"✅ Transcrição: {full_text[:100]}...")
            
            return jsonify({
                "text": full_text,
                "language": info.language,
                "language_probability": info.language_probability,
                "segments": segment_list
            })
            
        finally:
            # Limpar arquivo temporário
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
                
    except Exception as e:
        logger.error(f"❌ Erro na transcrição: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/detect-wake-word', methods=['POST'])
def detect_wake_word():
    """
    Detecta se o áudio contém a palavra de ativação "Alfred"
    
    Retorna:
        - { "detected": true/false, "text": "transcrição", "command": "resto do texto" }
    """
    try:
        if 'audio' not in request.files:
            return jsonify({"error": "Nenhum arquivo de áudio enviado"}), 400
        
        audio_file = request.files['audio']
        
        with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as tmp:
            audio_file.save(tmp.name)
            tmp_path = tmp.name
        
        try:
            segments, info = model.transcribe(
                tmp_path,
                language='pt',
                beam_size=1,
                vad_filter=True,
                initial_prompt="Alfred, toque música. Avenged Sevenfold, Guns N' Roses, Metallica, Iron Maiden, Seize the Day, tocar, pausa, pula, parar.",
                vad_parameters=dict(
                    min_silence_duration_ms=300,
                    threshold=0.3  # Threshold mais baixo = menos agressivo
                )
            )
            
            full_text = " ".join([s.text.strip() for s in segments]).lower()
            
            logger.info(f"🎤 Detectou: '{full_text}'")
            
            import re
            
            # Detectar "alfred" ou variações no início ou em qualquer lugar usando regex
            wake_word_pattern = r'\b(alfred[o]?|álfred[o]?|alfret|alferd|al\s+fred[o]?|afred|aufred|alfréd)\b'
            match = re.search(wake_word_pattern, full_text, re.IGNORECASE)
            detected = match is not None
            
            # Extrair comando (remover a palavra de ativação e pontuações do texto)
            command = ""
            if detected:
                # Remove a palavra de ativação encontrada
                matched_word = match.group(0)
                command = full_text.replace(matched_word, "", 1).strip()
                command = re.sub(r',\s*,', ',', command)
                command = re.sub(r'\s+', ' ', command)
                command = re.sub(r'^[,!?.\s\-]+|[,!?.\s\-]+$', '', command).strip()
            
            return jsonify({
                "detected": detected,
                "text": full_text,
                "command": command
            })
            
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
                
    except Exception as e:
        logger.error(f"❌ Erro na detecção: {e}")
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    print("""
    ===========================================
        Alfred Whisper Server
        Modelo: {model}
        Porta: 5000
    ===========================================
    """.format(model=MODEL_SIZE))
    
    app.run(host='0.0.0.0', port=5000, debug=False)
