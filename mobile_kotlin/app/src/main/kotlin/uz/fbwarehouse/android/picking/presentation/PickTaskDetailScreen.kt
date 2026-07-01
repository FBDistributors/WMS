package uz.fbwarehouse.android.picking.presentation

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import uz.fbwarehouse.android.R
import uz.fbwarehouse.android.core.network.PickingLineDto
import uz.fbwarehouse.android.ui.components.ErrorRetry
import uz.fbwarehouse.android.ui.components.LoadingBox
import uz.fbwarehouse.android.ui.format.formatQty

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PickTaskDetailScreen(
    onBack: () -> Unit,
    onScan: () -> Unit,
    scannedBarcode: String?,
    onScannedBarcodeConsumed: () -> Unit,
    viewModel: PickTaskDetailViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val document = uiState.document
    val snackbarHostState = remember { SnackbarHostState() }
    val notFoundMessage = stringResource(R.string.pick_task_scan_not_found)
    val queuedOfflineMessage = stringResource(R.string.pick_task_queued_offline)

    LaunchedEffect(scannedBarcode) {
        if (!scannedBarcode.isNullOrBlank()) {
            viewModel.pickLineByBarcode(scannedBarcode)
            onScannedBarcodeConsumed()
        }
    }

    LaunchedEffect(uiState.scanNotFound) {
        if (uiState.scanNotFound) {
            snackbarHostState.showSnackbar(notFoundMessage)
            viewModel.consumeScanNotFound()
        }
    }

    LaunchedEffect(uiState.lastPickQueued) {
        if (uiState.lastPickQueued) {
            snackbarHostState.showSnackbar(queuedOfflineMessage)
            viewModel.consumeLastPickQueued()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        stringResource(
                            R.string.pick_task_detail_title,
                            document?.orderNumber ?: document?.referenceNumber ?: "",
                        )
                    )
                },
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
        snackbarHost = { SnackbarHost(snackbarHostState) },
        floatingActionButton = {
            if (document != null) {
                FloatingActionButton(onClick = onScan) {
                    Icon(imageVector = Icons.Filled.QrCodeScanner, contentDescription = null)
                }
            }
        },
    ) { padding ->
        when {
            uiState.isLoading && document == null -> LoadingBox(modifier = Modifier.padding(padding))
            uiState.error != null && document == null -> ErrorRetry(
                error = uiState.error!!,
                onRetry = viewModel::load,
                modifier = Modifier.padding(padding),
            )
            document != null -> LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(document.lines, key = { it.id }) { line ->
                    PickLineCard(
                        line = line,
                        isSubmitting = uiState.submittingLineId == line.id,
                        onAddQty = { delta -> viewModel.pickLine(line.id, delta) },
                    )
                }
            }
        }
    }
}

@Composable
private fun PickLineCard(
    line: PickingLineDto,
    isSubmitting: Boolean,
    onAddQty: (Int) -> Unit,
) {
    var qtyText by remember(line.id) { mutableStateOf("") }
    val isDone = line.qtyPicked >= line.qtyRequired
    val enteredQty = qtyText.toIntOrNull()

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(text = line.productName, style = MaterialTheme.typography.titleMedium)
            Text(text = line.locationCode, style = MaterialTheme.typography.bodyMedium)
            Text(
                text = stringResource(
                    R.string.pick_line_required_picked,
                    formatQty(line.qtyRequired),
                    formatQty(line.qtyPicked),
                ),
                style = MaterialTheme.typography.labelMedium,
                modifier = Modifier.padding(top = 4.dp),
            )

            if (isDone) {
                Text(
                    text = stringResource(R.string.pick_line_done_label),
                    color = MaterialTheme.colorScheme.primary,
                    style = MaterialTheme.typography.labelMedium,
                    modifier = Modifier.padding(top = 8.dp),
                )
            } else {
                Row(
                    modifier = Modifier.padding(top = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    OutlinedTextField(
                        value = qtyText,
                        onValueChange = { input -> qtyText = input.filter(Char::isDigit) },
                        label = { Text(stringResource(R.string.pick_line_qty_hint)) },
                        singleLine = true,
                        enabled = !isSubmitting,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.weight(1f),
                    )
                    Button(
                        onClick = {
                            enteredQty?.takeIf { it > 0 }?.let { delta ->
                                onAddQty(delta)
                                qtyText = ""
                            }
                        },
                        enabled = !isSubmitting && enteredQty != null && enteredQty > 0,
                        modifier = Modifier.padding(start = 8.dp),
                    ) {
                        if (isSubmitting) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(18.dp),
                                color = MaterialTheme.colorScheme.onPrimary,
                            )
                        } else {
                            Text(stringResource(R.string.pick_line_add_button))
                        }
                    }
                }
            }
        }
    }
}
