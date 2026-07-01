package uz.fbwarehouse.android.inventory.presentation

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import uz.fbwarehouse.android.R
import uz.fbwarehouse.android.core.network.InventoryByBarcodeDto
import uz.fbwarehouse.android.ui.components.LoadingBox
import uz.fbwarehouse.android.ui.components.toDisplayMessageRes
import uz.fbwarehouse.android.ui.format.formatQty

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InventorySearchScreen(
    onBack: () -> Unit,
    onScan: () -> Unit,
    scannedBarcode: String?,
    onScannedBarcodeConsumed: () -> Unit,
    viewModel: InventorySearchViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    LaunchedEffect(scannedBarcode) {
        if (!scannedBarcode.isNullOrBlank()) {
            viewModel.onBarcodeScanned(scannedBarcode)
            onScannedBarcodeConsumed()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.inventory_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = stringResource(R.string.common_back),
                        )
                    }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = uiState.query,
                    onValueChange = viewModel::onQueryChange,
                    label = { Text(stringResource(R.string.inventory_search_hint)) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(onSearch = { viewModel.search() }),
                    modifier = Modifier.weight(1f),
                )
                IconButton(onClick = onScan) {
                    Icon(imageVector = Icons.Filled.QrCodeScanner, contentDescription = null)
                }
                Button(
                    onClick = viewModel::search,
                    enabled = !uiState.isLoading && uiState.query.isNotBlank(),
                    modifier = Modifier.padding(start = 8.dp),
                ) {
                    Text(stringResource(R.string.inventory_search_button))
                }
            }

            when {
                uiState.isLoading -> LoadingBox(modifier = Modifier.weight(1f))
                uiState.error != null -> Text(
                    text = stringResource(uiState.error!!.toDisplayMessageRes()),
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(top = 16.dp),
                )
                uiState.result != null -> InventoryResultCard(result = uiState.result!!)
                !uiState.hasSearched -> Text(
                    text = stringResource(R.string.inventory_search_empty_hint),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 16.dp),
                )
            }
        }
    }
}

@Composable
private fun InventoryResultCard(result: InventoryByBarcodeDto) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 16.dp),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(text = result.name, style = MaterialTheme.typography.titleMedium)
            result.barcode?.let { Text(text = it, style = MaterialTheme.typography.bodyMedium) }
            result.brand?.let { Text(text = it, style = MaterialTheme.typography.bodyMedium) }
            Text(
                text = stringResource(R.string.inventory_total_available, formatQty(result.totalAvailable)),
                style = MaterialTheme.typography.labelMedium,
                modifier = Modifier.padding(top = 8.dp),
            )

            if (result.bestLocations.isNotEmpty()) {
                Text(
                    text = stringResource(R.string.inventory_best_locations_title),
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.padding(top = 16.dp),
                )
                result.bestLocations.forEach { loc ->
                    Text(
                        text = "${loc.locationCode} — ${formatQty(loc.availableQty)}",
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
            }

            if (result.fefoLots.isNotEmpty()) {
                Text(
                    text = stringResource(R.string.inventory_fefo_lots_title),
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.padding(top = 16.dp),
                )
                result.fefoLots.forEach { lot ->
                    Column(modifier = Modifier.padding(top = 4.dp)) {
                        Text(
                            text = "${lot.batchNo} — ${formatQty(lot.availableQty)}",
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        lot.expiryDate?.let {
                            Text(
                                text = stringResource(R.string.inventory_expiry_label, it),
                                style = MaterialTheme.typography.labelMedium,
                            )
                        }
                    }
                }
            }
        }
    }
}
