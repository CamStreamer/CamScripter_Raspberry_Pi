let firstStart = true;

$(document).ready(() => {
  getVersion();
  renderPackages();

  $('#uploadManager').on('show.bs.modal', () => {
    // Clear file input and alerts
    $('#uploadedFileHelp').text('').removeClass('alert alert-danger');
    $('#pkg_name').val('');

    // Upload package
    $('#fileUpload').off().on('click', () => {
      uploadPackageAction();
      return false;
    });
  });

  $('#importSettings').on('show.bs.modal', (e) => {
    // Clear file input and alerts
    $('#importSettingsHelp').text('').removeClass('alert alert-danger');
    $('#settingsFile').val('');

    // Import settings
    const pckgName = $(e.relatedTarget).data('pckg-name');
    $('#importSettingsBtn').off().on('click', () => {
      importSettingsAction(pckgName);
      return false;
    });
  });

  const checkbox = $('#system_log_auto_reload');
  $('#system_log_auto_reload_btn').on('click', () => {
    if (checkbox.is(':checked')) {
      checkbox.removeAttr("checked");
    } else {
      checkbox.attr("checked", true);
    }
  });
});

function makeAlert(id, msg, type, alertDismissible, closeButton) {
  let alert = "";
  let targetDiv = (alertDismissible === true) ? '#alert-div-fluid' : '#alert-div';
  let exists = $(targetDiv).find('#' + id).length > 0;
  if (!exists) { // If not exists in targetDiv create and append
    alert += '<div id="' + id + '" class="alert show hide alert-' + type;
    if (alertDismissible === true) {
      alert += ' alert-dismissible';
    }
    alert += '" role="alert">' + msg;
    if (closeButton === true && alertDismissible !== true) {
      alert += '<button type="button" class="close" data-dismiss="alert" aria-label="Close"><span aria-hidden="true">&times;</span></button>';
    }
    alert += '</div>';

    $(targetDiv).append(alert);
  }

  if (alertDismissible === true) {
    $('#' + id).fadeTo(5000, 500).slideUp(500, () => {
      $('#' + id).alert('close');
    });
  }
}

function logError(message, status) {
  console.error('Error: ' + message + '(' + status + ')');
}

function escapeHtml(unsafeHtml) {
  return unsafeHtml.replace(/&/g, "").replace(/</g, "").replace(/>/g, "").replace(/"/g, "").replace(/'/g, "");
}

function getSystemLog() {
  $('#system_log_select').on('change', systemLogRefresh);
  systemLogLoop();
}

async function systemLogLoop() {
  try {
    if ($('#system_log_auto_reload').is(':checked')) {
      await systemLogRefresh();
    }
  } catch (err) {
    console.error(err);
  } finally {
    setTimeout(systemLogLoop, 5000);
  }
}

function systemLogRefresh() {
  return new Promise((resolve, reject) => {
    $('#system_log_loading').html(loadingSystemLogRender());
    const package = $('#system_log_select').val();
    $('#syslog_new_tab').attr('href', 'systemlog.cgi?package_name=' + package);
    $.get('systemlog.cgi?package_name=' + package).done((response) => {
      data = response.split("\n");
      const length = data.length;
      let begin = length - 100;
      if (begin < 0) {
        begin = 0;
      }
      let output = "";
      for (i = begin; i < length; i++) {
        output += data[i] + "\n";
      }
      $('#system_log').text(output);
    }).always(() => {
      $('#system_log_loading').html("");
      const element = $('#system_log_scroll');
      element.scrollTop(element.prop("scrollHeight") - element.height());
      resolve();
    });
  });
}

function validateUploadPackageForm() {
  let err = 0;
  const inputFileArr = $('#pkg_name')[0].files;
  if (inputFileArr.length == 0) {
    err = 2;
  }
  for (let i = 0; i < inputFileArr.length; i++) {
    const fileName = inputFileArr[i].name.toLowerCase();
    if (fileName.indexOf('.zip') === -1) {
      err = 1;
      break;
    }
  }
  if (err == 1) {
    $('#uploadedFileHelp').text('Only *.zip is allowed.').addClass('alert alert-danger');
    return false;
  } else if (err == 2) {
    $('#uploadedFileHelp').text('You must upload file *.zip.').addClass('alert alert-danger');
    return false;
  } else {
    $('#uploadedFileHelp').text('').removeClass('alert alert-danger');
  }
  return true;
}

function uploadPackageAction() {
  if (validateUploadPackageForm()) {
    const form = $('#uploadManagerForm')[0];
    const name = $('#pkg_name')[0].files[0]["name"].split(".");
    const formData = new FormData(form);
    $('#fileUpload').html('<span class="fas fa-circle-notch fa-spin mr-2"></span> Uploading');
    $.ajax({
      url: 'package/install.cgi',
      data: formData,
      type: 'POST',
      contentType: false,
      processData: false,
    }).done((response) => {
      getPackageList();
      $('#uploadManager').modal('hide');
      makeAlert('new-package', 'New micro app <strong>' + name[0] + '</strong> was uploaded on the camera.', 'info', true, true);
    }).fail(function (response) {
      $('#uploadedFileHelp').html(
        '<div class="alert alert-danger">Unable to upload file(s). Please try again.</div>'
      );
      logError(response.responseJSON.message, response.responseJSON.status);
    }).always(() => {
      $('#fileUpload').html('Upload Package');
    });
    return false;
  }
  return false;
}

function validateImportSettingsForm() {
  const inputFileArr = $('#settingsFile')[0].files;
  if (inputFileArr.length == 0) {
    $('#importSettingsHelp').text('You must upload file *.zip.').addClass('alert alert-danger');
    return false;
  } else if (inputFileArr[0].name.toLowerCase().indexOf('.zip') === -1) {
    $('#importSettingsHelp').text('Only *.zip is allowed.').addClass('alert alert-danger');
  } else {
    $('#importSettingsHelp').text('').removeClass('alert alert-danger');
  }
  return true;
}

function importSettingsAction(packageName) {
  if (validateImportSettingsForm()) {
    const form = $('#importSettingsForm')[0];
    const name = $('#settingsFile')[0].files[0]["name"].split(".");
    const formData = new FormData(form);
    $('#importSettingsBtn').html('<span class="fas fa-circle-notch fa-spin mr-2"></span> Importing');
    $.ajax({
      url: 'package/data.cgi?action=IMPORT&package_name=' + packageName,
      data: formData,
      type: 'POST',
      contentType: false,
      processData: false,
    }).done((response) => {
      $('#importSettings').modal('hide');
      makeAlert('import-data', 'Setting file <strong>' + name[0] + '</strong> was imported.', 'info', true, true);
    }).always(() => {
      $('#importSettingsBtn').html('Import Settings');
    });
    return false;
  }
  return false;
}

// List of all packages
function renderPackages() {
  getSystemLog()
  if (!firstStart) {
    getPackageList();
  } else {
    $('#content').html(loadingPageRender());
    getPackageList();
  }
}

function getParameter(paramList) {
  return new Promise((resolve, reject) => {
    $.get("param.cgi?action=list&group=" + paramList, (data) => {
      let params = {};
      let lines = data.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const pos = lines[i].indexOf('=');
        if (pos != -1) {
          const name = lines[i].substring(0, pos).trim().toLowerCase();
          const value = lines[i].substring(pos + 1).trim();
          if (name.length && value.length) {
            params[name] = value;
          }
        }
      }
      resolve(params);
    });
  });
}

function setParameter(appName, paramName, value) {
  return new Promise((resolve, reject) => {
    let dataJson = {};
    dataJson['action'] = 'update';
    dataJson[appName + '.' + paramName] = value;

    $.ajax({
      method: "POST",
      cache: true,
      url: "param.cgi",
      data: dataJson
    }).done((msg) => {
      try {
        if (msg.trim().toLowerCase() == 'ok')
          resolve();
        else
          reject();
      } catch (err) {
        reject();
      }

    });
  });
}

function getPackageList() {
  $.ajax({
    type: 'GET',
    url: 'package/list.cgi',
    dataType: 'json',
    success: (response) => {
      getParameter("camscripter.PackageConfigurations").then((paramData) => {
        let packageConfigurations = {};
        if (paramData["camscripter.packageconfigurations"] != undefined) {
          packageConfigurations = JSON.parse(paramData["camscripter.packageconfigurations"]);
        }
        listOfPackagesRender(response, packageConfigurations);
        let selected = $('#system_log_select').val();
        $('#system_log_select').html(listOfSyslogOptions(response, selected));
      });
    },
    error: (response) => {
      makeAlert('package-list-error', 'Something went wrong with list all packages, please try again.', 'danger', true, true);
      logError(response.message, response.status);
    }
  });
}
function listOfSyslogOptions(response, selected) {
  let output = selected === 'system' ? '<option value="system" selected>System</option>' : '<option value="system">System</option>';
  if (!response) {
    return output;
  } else {
    for (let i = 0; i < response.length; i++) {
      if (response[i].package_name === selected) {
        output += `<option value=${response[i].package_name} selected>${response[i].package_menu_name}</option>`;
      } else {
        output += `<option value=${response[i].package_name}>${response[i].package_menu_name}</option>`;
      }
    }
  }
  return output;
}
function loadingPageRender() {
  let output = "";
  output += '<div class="card card-empty text-center" style="background-color: #F5F5F5;">';
  output += '<div class="card-body">';
  output += '<blockquote class="blockquote mb-0"><p><span class="fas fa-2x fa-circle-notch fa-spin text-primary"></span></p></blockquote>';
  output += '</div>';
  output += '</div>';
  return output;
}

function loadingSystemLogRender() {
  let output = "";
  output += '<span class="h6 fas fa-circle-notch fa-spin text-primary"></span>';
  return output;
}

function emptyPageRender() {
  let output = "";
  output += '<div class="card card-empty text-center">';
  output += '<div class="card-body">';
  output += '<blockquote class="blockquote mb-0"><p>No packages installed</p></blockquote>';
  output += '<button type="button" data-toggle="modal" data-target="#uploadManager" class="btn btn-sm btn-primary pt-2 pb-2 pl-4 pr-4"><span class="fas fa-plus mr-2"></span>Add new package</button>';
  output += '</div>';
  output += '</div>';
  return output;
}


function listOfPackagesRender(response, dataJson) {
  let output = "";
  // Make array of running packages
  if (response.length == 0) {
    output = emptyPageRender();
  } else {
    output += '<div class="card-columns">';
    for (let i = 0; i < response.length; i++) {
      const exportUrl = 'package/data.cgi?action=EXPORT&package_name=' + response[i].package_name;
      if (i % 3 === 0) {
        output += '</div>';
        output += '<div class="card-columns">';
      }
      output += '<div class="card">';
      output += '<div class="card-body">';
      output += '<h5 class="text-left">'
      if (dataJson[response[i].package_name] == undefined) {
        output += '<span data-toggle="tooltip" title="Stopped"><span class="mr-2 fas fa-circle text-secondary"></span></span>';
      } else {
        output += '<span data-toggle="tooltip" title="Running"><span class="mr-2 fas fa-circle text-primary"></span></span>';
      }
      output += response[i].package_menu_name;
      output += '<div style="float:right;" class="ml-auto">'
      output += '<button class="btn btn-sm btn-dropdown" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">'
      output += '<span class="d-flex fas fa-ellipsis-v"></span></button>'
      output += '<div class="dropdown-menu">'
      output += '<a class="dropdown-item" href="' + exportUrl + '" download="' + response[i].package_name + '_settings.zip">Export Settings</a>'
      output += '<a class="dropdown-item" href="#" data-toggle="modal" data-target="#importSettings" data-pckg-name="' + response[i].package_name + '">Import Settings</a>'
      output += '<div class="dropdown-divider"></div>'
      output += '<a class="dropdown-item btn_remove_package" href="#" data-remove-package="' + response[i].package_name + '">Uninstall</a>'
      output += '</div>'
      output += '</div>';
      output += '</h5>';
      output += '<div class="mt-4 d-flex">';
      output += '<div class="mr-auto">';
      output += '<span class="mt-1 mb-1 badge badge-secondary">v ' + response[i].package_version + '</span>';
      output += '</div>';
      output += '<div class="ml-auto btn-group border rounded" role="group" aria-label="Options">';
      if (dataJson[response[i].package_name] !== undefined && response[i].ui_link !== "") {
        output += '<button class="href-card btn btn-sm btn-primary" data-href="' + response[i].ui_link + '">Open</button>';
      }
      if (dataJson[response[i].package_name] == undefined) {
        output += '<button class="startPackage btn btn-sm btn-light" data-package="' + response[i].package_name + '">Start</button>';
      } else {
        output += '<button class="stopPackage btn btn-sm btn-light" data-package="' + response[i].package_name + '">Stop</button>';
      }
      output += '</div>';
      output += '</div>';
      output += '</div>';
      output += '</div>';
    }
    output += '</div>';
  }
  $('#content').html(output);

  removePackageAction();

  confirmUninstallAction();

  linkToUiAction();

  startPackageAction();

  stopPackageAction();
}

function removePackageAction() {
  $('.btn_remove_package').on('click', (e) => {
    const removePackageData = $(e.target).attr('data-remove-package');
    $('#confirmUninstall').modal();
    $('#confirmUninstallYes').attr('data-remove', removePackageData);
    $('#confirmUninstallText').html('Do you really want to uninstall the app <strong>' + removePackageData + '</strong> ?');
    return false;
  });
}

function confirmUninstallAction() {
  isRemoved = 0;
  $('#confirmUninstallYes').on('click', (e) => {
    if (isRemoved === 0) {
      isRemoved = 1;
      const removePackageData = $(e.target).attr('data-remove');
      $('#confirmUninstall').modal('hide');
      removePackage(removePackageData);
      stopRunningPackage(removePackageData);
      getPackageList();
      return false;
    }
  });
}

function linkToUiAction() {
  $('.href-card').on('click', (e) => {
    const url = $(e.target).closest('button').attr('data-href');
    const win = window.open(url, '_blank');
    win.focus();
  });
}

function stopRunningPackage(packageName) {
  getParameter('camscripter.packageconfigurations').then((paramData) => {
    let packageConfigurations = {};
    if (paramData["camscripter.packageconfigurations"] != undefined) {
      packageConfigurations = JSON.parse(paramData["camscripter.packageconfigurations"]);
    }
    if (packageConfigurations[packageName] != undefined) {
      // if package is included
      delete packageConfigurations[packageName];
    }
    const packageConfigurationsData = JSON.stringify(packageConfigurations);
    setParameter('camscripter', 'PackageConfigurations', packageConfigurationsData).then(() => {
      getPackageList();
    });
  });
}

function setRunningPackage(packageName) {
  getParameter('camscripter.packageconfigurations').then((paramData) => {
    let packageConfigurations = {};
    if (paramData["camscripter.packageconfigurations"] != undefined) {
      packageConfigurations = JSON.parse(paramData["camscripter.packageconfigurations"]);
    }
    if (packageConfigurations[packageName] == undefined) {
      // if package is not included
      packageConfigurations[packageName] = { "enabled": true };
    }
    const packageConfigurationsData = JSON.stringify(packageConfigurations);
    setParameter('camscripter', 'packageconfigurations', packageConfigurationsData).then(() => {
      getPackageList();
    });
  });
}

function startPackageAction() {
  $('.startPackage').on('click', (e) => {
    e.stopPropagation();
    const packageName = $(e.target).attr('data-package');
    setRunningPackage(packageName);
  });
}

function stopPackageAction() {
  $(".stopPackage").on('click', (e) => {
    e.stopPropagation();
    const packageName = $(e.target).attr('data-package');
    stopRunningPackage(packageName);
  });
}

function removePackage(packageName) {
  $.ajax({
    type: 'GET',
    url: 'package/remove.cgi',
    data: { package_name: packageName },
    success: (response) => {
      makeAlert('package-remove', 'Package <strong>' + packageName + '</strong> was removed from this device.', 'info', true, true);
    },
    error: (response) => {
      makeAlert('package-remove-error', 'Something went wrong with remove package, please try again.', 'danger', true, true);
      logError(response.message, response.status);
    }
  });
}

function getVersion(packageName) {
  $.ajax({
    type: 'GET',
    url: 'version.cgi',
    success: (response) => {
      $('#main_menu').html('<a id="cscrbi" class="active mr-2 nav-link btn-menu" href="/">CamScripter RPi\
        <span class="ml-2 badge badge-dark" style="font-size: 0.6rem;">' + response + '</span></a>')
    },
    error: (response) => {
      makeAlert('package-remove-error', 'Something went wrong during version check, please try again.', 'danger', true, true);
      logError(response.message, response.status);
    }
  });
}