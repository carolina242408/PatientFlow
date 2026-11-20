"""Small FT-Transformer with fold-local preprocessing and inner early stopping."""

import logging
import random
from pathlib import Path

import joblib
import numpy as np
import torch
from rtdl_revisiting_models import FTTransformer
from sklearn.model_selection import GroupShuffleSplit, train_test_split
from sklearn.preprocessing import OrdinalEncoder, StandardScaler

from .config import CATEGORICAL_FEATURES, NUMERIC_FEATURES, SEED

LOGGER = logging.getLogger(__name__)


def seed_torch(workers):
    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(SEED)
    torch.set_num_threads(workers)
    torch.backends.cudnn.benchmark = False
    torch.backends.cudnn.deterministic = True
    torch.use_deterministic_algorithms(True)


class FTTransformerRegressor:
    def __init__(self, parameters, device="cuda", workers=1, max_epochs=200, patience=20):
        self.parameters = parameters.copy()
        self.device = device
        self.workers = workers
        self.max_epochs = max_epochs
        self.patience = patience

    def _initialize(self, features):
        seed_torch(self.workers)
        self.scaler = StandardScaler().fit(features[NUMERIC_FEATURES])
        self.encoder = OrdinalEncoder(
            handle_unknown="use_encoded_value", unknown_value=-1, dtype=np.int64
        ).fit(features[CATEGORICAL_FEATURES])
        self.cardinalities = [len(categories) + 1 for categories in self.encoder.categories_]
        self.network = self._make_network().to(self.device)

    def _make_network(self):
        architecture = {key: value for key, value in self.parameters.items() if key not in {
            "learning_rate", "weight_decay", "batch_size"
        }}
        return FTTransformer(
            n_cont_features=len(NUMERIC_FEATURES),
            cat_cardinalities=self.cardinalities,
            d_out=1,
            ffn_d_hidden=None,
            residual_dropout=0.0,
            **architecture,
        )

    def _tensors(self, features):
        continuous = np.asarray(self.scaler.transform(features[NUMERIC_FEATURES]), dtype=np.float32)
        # Index zero is reserved for unseen categories; all learned categories start at one.
        categorical = np.asarray(self.encoder.transform(features[CATEGORICAL_FEATURES]), dtype=np.int64) + 1
        return (
            torch.as_tensor(continuous, device=self.device),
            torch.as_tensor(categorical, device=self.device),
        )

    def _fit_epochs(self, features, target, epochs, validation=None):
        continuous, categorical = self._tensors(features)
        labels = torch.as_tensor(np.asarray(target, dtype=np.float32), device=self.device)
        optimizer = torch.optim.AdamW(
            self.network.make_parameter_groups(),
            lr=self.parameters["learning_rate"],
            weight_decay=self.parameters["weight_decay"],
        )
        loss_function = torch.nn.L1Loss()
        generator = torch.Generator().manual_seed(SEED)
        best_mae, best_epoch, stale_epochs = float("inf"), 0, 0
        batch_size = self.parameters["batch_size"]
        for epoch in range(1, epochs + 1):
            self.network.train()
            order = torch.randperm(len(labels), generator=generator).to(self.device)
            for batch in order.split(batch_size):
                optimizer.zero_grad(set_to_none=True)
                prediction = self.network(continuous[batch], categorical[batch]).squeeze(-1)
                loss = loss_function(prediction, labels[batch])
                if not torch.isfinite(loss).item():
                    raise RuntimeError(f"FT-Transformer loss became nonfinite at epoch {epoch}.")
                loss.backward()
                optimizer.step()
            if validation is not None:
                validation_features, validation_target = validation
                mae = float(np.mean(np.abs(self.predict(validation_features) - np.asarray(validation_target))))
                if mae < best_mae:
                    best_mae, best_epoch, stale_epochs = mae, epoch, 0
                else:
                    stale_epochs += 1
                if stale_epochs >= self.patience:
                    break
        return best_epoch if validation is not None else epochs

    def fit(self, features, target, groups=None, epochs=None):
        if epochs is None:
            # The outer CV validation fold and final test set are never used for early stopping.
            indices = np.arange(len(features))
            if groups is None:
                inner_train, inner_validation = train_test_split(
                    indices, test_size=0.15, random_state=SEED, shuffle=True
                )
            else:
                if groups.nunique() < 2:
                    raise ValueError("FT-Transformer early stopping needs at least two training patients.")
                splitter = GroupShuffleSplit(n_splits=1, test_size=0.15, random_state=SEED)
                inner_train, inner_validation = next(splitter.split(features, target, groups))
            self._initialize(features.iloc[inner_train])
            epochs = self._fit_epochs(
                features.iloc[inner_train], target.iloc[inner_train], self.max_epochs,
                validation=(features.iloc[inner_validation], target.iloc[inner_validation]),
            )
            LOGGER.info("FT-Transformer inner validation selected %s epochs; refitting on the full fold.", epochs)
            del self.network
            if self.device == "cuda":
                torch.cuda.empty_cache()
        if epochs < 1:
            raise ValueError("The training epoch count must be positive.")
        self._initialize(features)
        self._fit_epochs(features, target, epochs)
        self.epochs_ = epochs
        self.network.eval()
        return self

    def predict(self, features):
        self.network.eval()
        continuous, categorical = self._tensors(features)
        outputs = []
        with torch.inference_mode():
            for start in range(0, len(features), self.parameters["batch_size"]):
                stop = start + self.parameters["batch_size"]
                prediction = self.network(continuous[start:stop], categorical[start:stop]).squeeze(-1)
                outputs.append(prediction.cpu().numpy())
        return np.concatenate(outputs).astype(float)

    def save(self, directory: Path):
        joblib.dump({"scaler": self.scaler, "encoder": self.encoder}, directory / "preprocessor.joblib")
        torch.save({
            "parameters": self.parameters,
            "cardinalities": self.cardinalities,
            "epochs": self.epochs_,
            "state_dict": {key: value.detach().cpu() for key, value in self.network.state_dict().items()},
        }, directory / "weights.pt")

    @classmethod
    def load(cls, directory: Path, device="cpu"):
        checkpoint = torch.load(directory / "weights.pt", map_location="cpu", weights_only=True)
        preprocessor = joblib.load(directory / "preprocessor.joblib")
        model = cls(checkpoint["parameters"], device=device)
        model.scaler = preprocessor["scaler"]
        model.encoder = preprocessor["encoder"]
        model.cardinalities = checkpoint["cardinalities"]
        model.epochs_ = checkpoint["epochs"]
        model.network = model._make_network()
        model.network.load_state_dict(checkpoint["state_dict"])
        model.network.to(device).eval()
        return model
