import json
import logging
import threading
import time

import pika

REQUESTS = "discharge.prediction.requests"
RESULTS = "discharge.prediction.results"
RETRY_SECONDS = 5

logger = logging.getLogger("algorithms.queue")
logging.getLogger("pika").setLevel(logging.WARNING)


def start(url: str, handle) -> None:
    threading.Thread(target=_run, args=(url, handle), daemon=True, name="prediction-queue").start()


def _run(url: str, handle) -> None:
    params = pika.URLParameters(url)

    params.heartbeat = 600
    while True:
        try:
            with pika.BlockingConnection(params) as connection:
                channel = connection.channel()
                channel.queue_declare(REQUESTS, durable=True)
                channel.queue_declare(RESULTS, durable=True)
                channel.confirm_delivery()
                channel.basic_qos(prefetch_count=1)
                logger.info("A consumir pedidos de previsão de alta da fila %s", REQUESTS)
                for method, _, body in channel.consume(REQUESTS):
                    _process(channel, method, body, handle)

        except Exception as error: # ligação perdida ou broker ainda a arrancar
            logger.warning("Sem ligação ao RabbitMQ (%s); nova tentativa em %ss", type(error).__name__, RETRY_SECONDS)
            time.sleep(RETRY_SECONDS)


def _process(channel, method, body: bytes, handle) -> None:
    try:
        result = handle(json.loads(body))
    except json.JSONDecodeError:
        logger.warning("Pedido de previsão ilegível descartado")
        result = None
    except BlockingIOError:
        # Modelo ocupado
        channel.basic_nack(method.delivery_tag, requeue=True)
        time.sleep(RETRY_SECONDS)
        return
    except Exception as error:
        # Uma segunda falha do mesmo pedido é descartada para não bloquear a fila para sempre.
        retry = not method.redelivered
        logger.error("Previsão falhou (%s); %s", type(error).__name__, "volta à fila" if retry else "pedido descartado")
        channel.basic_nack(method.delivery_tag, requeue=retry)
        time.sleep(RETRY_SECONDS)
        return
    if result is not None:
        channel.basic_publish(
            "", RESULTS, json.dumps(result).encode(),
            pika.BasicProperties(delivery_mode=2, content_type="application/json"), mandatory=True)
    channel.basic_ack(method.delivery_tag)
