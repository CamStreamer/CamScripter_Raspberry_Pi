var app_name = 'CamScripter';

var serverUrl = null;
var defaultPage = 'settings.html';

var firstStart = 1;



$(document).ready(function () {
  get_version();
  renderPackages();

  // Upload packages
  $('#fileUpload').on('click', function () {
    upload_package_action();
    return false;
  });

  // Clear file input
  $('#uploadManager').on('show.bs.modal', function () {
    $('#pkg_name').val('');
  });

  var checkbox = $('#system_log_auto_reload');
  $('#system_log_auto_reload_btn').on('click', function () {
    if (checkbox.is(':checked')) {
      checkbox.removeAttr("checked");
    } else {
      checkbox.attr("checked", true);
    }
  });
});



// function - alert
function make_alert(id, msg, type, alert_dismissible, close_button) {
  var alert = "";
  var targetDiv = (alert_dismissible === true) ? '#alert-div-fluid' : '#alert-div';
  var exists = 0;
  if ($(targetDiv).find('#' + id).length > 0) exists = 1;

  if (!exists) { // if not exists in targetDiv create and append
    alert += '<div id="' + id + '" class="alert show hide alert-' + type;
    if (alert_dismissible === true) {
      alert += ' alert-dismissible';
    }
    alert += '" role="alert">' + msg;
    if (close_button === true && alert_dismissible !== true) {
      alert += '<button type="button" class="close" data-dismiss="alert" aria-label="Close"><span aria-hidden="true">&times;</span></button>';
    }
    alert += '</div>';

    $(targetDiv).append(alert);
  }

  //alert dismissible
  if (alert_dismissible === true) {
    $('#' + id).fadeTo(5000, 500).slideUp(500, function () {
      $('#' + id).alert('close');
    });
  }
}

// function - log error
function log_error(message, status) {
  console.log('Error: ' + message + '(' + status + ')');
}

function escapeHtml(unsafe_html) {
  return unsafe_html.replace(/&/g, "").replace(/</g, "").replace(/>/g, "").replace(/"/g, "").replace(/'/g, "");
}


function systemLogLoop(){
  if ($('#system_log_auto_reload').is(':checked')) {
    systemLogRefresh();
  }
}

function systemLogRefresh() {
  $('#system_log_loading').html(loadingSystemLogRender());
    let package = $('#system_log_select').val();
    $('#syslog_new_tab').attr('href', '/systemlog.cgi?package_name=' + package);
    $.get({
      url: '/systemlog.cgi?package_name=' + package,
      success: function (response) {
        data = response.split("\n");
        var length = data.length;
        var begin = length - 100;
        if (begin < 0) {
          begin = 0;
        }
        var output = "";
        for (i = begin; i < length; i++) {
          output += data[i] + "\n";
        }
        $('#system_log').text(output);
      },
      error: function (response) {
        make_alert('get-system-log-error', response.message, 'error', true, true);
      }
    }).done(function () {
      $('#system_log_loading').html("");
      var element = $('#system_log_scroll');
      element.scrollTop(element.prop("scrollHeight") - element.height());

    });
}

// get system log
function getSystemLog() {
  $('#system_log_select').on('change', systemLogRefresh);
  systemLogLoop();

  setInterval(function () {
    systemLogLoop();

  }, 5000);

}

// function - validate upload package form
function validateForm() {
  err = 0;
  var inputFileArr = $('#pkg_name')[0].files;
  if (inputFileArr.length == 0) {
    err = 2;
  }
  for (var i = 0; i < inputFileArr.length; i++) {
    var fileName = inputFileArr[i].name.toLowerCase();
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
    $('#uploadManager').modal('hide');
    $('#uploadedFileHelp').text('').removeClass('alert alert-danger');
  }
  return true;
}

// action - upload package
function upload_package_action() {
  if (validateForm()) {
    var form = $('#uploadManagerForm')[0];
    var name = $('#pkg_name')[0].files[0]["name"].split(".");
    var formData = new FormData(form);
    $.ajax({
      url: '/package/install.cgi',
      data: formData,
      type: 'POST',
      contentType: false,
      processData: false,
      complete: function () {
        stopRunningPackage(name[0]);
        getPackageList(); //render packages again
      },
      success: function (response) {
        make_alert('new-package', 'New package <strong>' + name[0] + '</strong> was uploaded on camera.', 'info', true, true);
      },
      error: function (response) {
        make_alert('new-package-error', 'Something went wrong with upload new package, please try again.', 'danger', true, true);
        log_error(response.message, response.status);
      }
    });
    return false;
  }
  return false;
}

// List of all packages
function renderPackages() {


    getSystemLog()
    var currentVersionParam = '1.0.0';
    var currentVersion = currentVersionParam.split('.');

    if (firstStart == 0) {
      getPackageList();
    } else {
      $('#content').html(loadingPageRender());
      getPackageList();

    }
}

function getParameter(paramList) {
  var promise = new Promise(function(resolve, reject) {
    $.get("/param.cgi?action=list&group=" + paramList, function(data) {
      var params = {};
      var lines = data.split('\n');
      for (var i = 0; i < lines.length; i++) {
        var pos = lines[i].indexOf('=');
        if (pos != -1) {
          var name = lines[i].substring(0, pos).trim().toLowerCase();
          var value = lines[i].substring(pos + 1).trim();
          if (name.length && value.length) {
            params[name] = value;
          }
        }
      }
      resolve(params);
    });
  });
  return promise;
}

function setParameter(app_name, paramName, value) {
  var promise = new Promise(function(resolve, reject) {
    var dataJson = {};
    dataJson['action'] = 'update';
    dataJson[app_name + '.' + paramName] = value;

    $.ajax({
      method: "POST",
      cache: true,
      url: "/param.cgi",
      data: dataJson
    }).done(function(msg) {
      try {
        if (msg.trim().toLowerCase() == 'ok')
          resolve();
        else
          reject();
      } catch(err) {
        reject();
      }

    });
  });
  return promise;
}

function getPackageList() {
  $.ajax({
    type: 'GET',
    url: '/package/list.cgi',
    dataType: 'json',
    success: function (response) {
      getParameter("camscripter.PackageConfigurations").then(function (data) {
        var data = data["camscripter.packageconfigurations"];
        if (data != undefined) {
          dataJson = JSON.parse(data);

        } else {
          dataJson = {};
        }
        listOfCamerasRender(response, dataJson);
        let selected = $('#system_log_select').val();
        $('#system_log_select').html(listOfSyslogOptions(response, selected));
      });
    },
    error: function (response) {
      make_alert('package-list-error', 'Something went wrong with list all packages, please try again.', 'danger', true, true);
      log_error(response.message, response.status);
    }
  });
}
function listOfSyslogOptions(response, selected) {
  var output = selected === 'system' ? '<option value="system" selected>System</option>' : '<option value="system">System</option>';
  if (!response) {
    return output;
  } else {
    for (var i = 0; i < response.length; i++) {
      if (response[i].package_name === selected){
        output += `<option value=${response[i].package_name} selected>${response[i].package_menu_name}</option>`;
      }else{
        output += `<option value=${response[i].package_name}>${response[i].package_menu_name}</option>`;
      }
    }
  }
  return output;
}
function loadingPageRender() {
  var output = "";
  output += '<div class="card card-empty text-center" style="background-color: #F5F5F5;">';
  output += '<div class="card-body">';
  output += '<blockquote class="blockquote mb-0"><p><span class="fas fa-2x fa-circle-notch fa-spin text-primary"></span></p></blockquote>';
  output += '</div>';
  output += '</div>';
  return output;
}

function loadingSystemLogRender() {
  var output = "";
  output += '<span class="h6 fas fa-circle-notch fa-spin text-primary"></span>';
  return output;
}

function emptyPageRender() {
  var output = "";
  output += '<div class="card card-empty text-center">';
  output += '<div class="card-body">';
  output += '<blockquote class="blockquote mb-0"><p>No packages installed</p></blockquote>';
  output += '<button type="button" data-toggle="modal" data-target="#uploadManager" class="btn btn-sm btn-primary pt-2 pb-2 pl-4 pr-4"><span class="fas fa-plus mr-2"></span>Add new package</button>';
  output += '</div>';
  output += '</div>';
  return output;
}


function listOfCamerasRender(response, dataJson) {
  var output = "";
  //make array of running packages
  if (response.length == 0) {
    output = emptyPageRender();
  } else {
    output += '<div class="card-columns">';
    for (var i = 0; i < response.length; i++) {
      if (i % 3 === 0) {
        output += '</div>';
        output += '<div class="card-columns">';
      }
      output += '<div class="card">';
      output += '<div class="card-body">';
      output += '<h5 class="text-left">' + response[i].package_menu_name;
      if (dataJson[response[i].package_name] == undefined) {
        output += '<span class="ml-4 mb-1 fas fa-circle text-secondary"></span>';
      } else {
        output += '<span class="ml-4 mb-1 fas fa-circle text-primary"></span>';
      }
      if (dataJson[response[i].package_name] == undefined || response[i].ui_link == "") {
      } else {
        output += '<div style="float:right;" class="ml-auto btn-group border rounded"><button class="href-card btn btn-sm btn-light" data-href="' + response[i].ui_link + '"><span class="d-flex fas fa-cog"></span></button></div>';
      }
      output += '</h5>';
      output += '<div class="mt-4 d-flex">';
      output += '<div class="mr-auto">';
      output += '<span class="mt-1 text-secondary">v ' + response[i].package_version + '</span>';
      output += '</div>';
      output += '<div class="ml-auto btn-group border rounded" role="group" aria-label="Options">';
      if (dataJson[response[i].package_name] == undefined) {
        output += '<button class="startPackage btn btn-sm btn-light" data-package="' + response[i].package_name + '">Start</button>';
      } else {
        output += '<button class="stopPackage btn btn-sm btn-light" data-package="' + response[i].package_name + '">Stop</button>';
      }
      output += '<button data-remove-package="' + response[i].package_name + '" class="btn btn-sm btn-light btn_remove_package">Uninstall</button>';
      output += '</div>';
      output += '</div>';
      output += '</div>';
      output += '</div>';
    }
    output += '</div>';
  }
  //fill content with data
  $('#content').html(output);

  //remove package action
  remove_package_action();

  //confirm delete package
  confirm_delete_action();

  //link to UI action
  link_to_ui_action();

  //start package action
  start_package_action();

  //stop package action
  stop_package_action();
}

// action - remove package
function remove_package_action() {
  $('.btn_remove_package').on('click', function () {
    var remove_package_data = $(this).attr('data-remove-package');
    $('#confirmDelete').modal();
    $('#confirmDeleteYes').attr('data-remove', remove_package_data);
    $('#confirmDeleteText').html('Do you really want to uninstall the app <strong>' + remove_package_data + '</strong> ?');
    return false;
  });
}

//action - confirm delete package
function confirm_delete_action() {
  isRemoved = 0;
  $('#confirmDeleteYes').on('click', function () {
    if (isRemoved === 0) {
      isRemoved = 1;
      var remove_package_data = $(this).attr('data-remove');
      $('#confirmDelete').modal('hide');
      remove_package(remove_package_data);
      stopRunningPackage(remove_package_data);
      getPackageList();
      return false;
    }
  });
}

// action - link to UI
function link_to_ui_action() {
  $('.href-card').on('click', function () {
    var url = $(this).attr('data-href');
    var win = window.open(url, '_blank');
    win.focus();
  });
}

// function - remove item from runnig packages
function stopRunningPackage(package_name) {

  getParameter('camscripter.packageconfigurations').then(function (data) {
    var data = data["camscripter.packageconfigurations"];

    if (data != undefined) {
      dataJson = JSON.parse(data);
    }
    if (dataJson[package_name] != undefined) {
      //if package is included
      delete dataJson[package_name];
    }
    dataJson = JSON.stringify(dataJson);
    setParameter('camscripter', 'PackageConfigurations', dataJson).then(function () {
      getPackageList();
    });
  });
}

// function - add item to running packages
function setRunningPackage(package_name) {

  getParameter('camscripter.packageconfigurations').then(function (data) {
    var data = data["camscripter.packageconfigurations"];
    if (data != undefined) {
      dataJson = JSON.parse(data);
    }
    if (dataJson[package_name] == undefined) {
      //if package is not included
      dataJson[package_name] = { "enabled": true };
    }

    dataJson = JSON.stringify(dataJson);
    setParameter('camscripter', 'packageconfigurations', dataJson).then(function () {
      getPackageList();
    });
  });
}

// action - start package
function start_package_action() {
  $('.startPackage').on('click', function (e) {
    e.stopPropagation();
    var package_name = $(this).attr('data-package');
    setRunningPackage(package_name);
  });
}

// action - stop package
function stop_package_action() {
  $(".stopPackage").on('click', function (e) {
    e.stopPropagation();
    var package_name = $(this).attr('data-package');
    stopRunningPackage(package_name);
  });
}

// basic remove package function
function remove_package(package_name) {
  $.ajax({
    type: 'GET',
    url: '/package/remove.cgi',
    data: { package_name: package_name },
    success: function (response) {
      make_alert('package-remove', 'Package <strong>' + package_name + '</strong> was removed from this device.', 'info', true, true);
    },
    error: function (response) {
      make_alert('package-remove-error', 'Something went wrong with remove package, please try again.', 'danger', true, true);
      log_error(response.message, response.status);
    }
  });
}

function get_version(package_name) {
  $.ajax({
    type: 'GET',
    url: '/version.cgi',
    success: function (response) {
      $('#main_menu').html('<a id="cscrbi" class="active mr-2 nav-link btn-menu" href="/">CamScripter RPi\
        <span class="ml-2 badge badge-dark" style="font-size: 0.6rem;">' + response + '</span></a>')
    },
    error: function (response) {
      make_alert('package-remove-error', 'Something went wrong during version check, please try again.', 'danger', true, true);
      log_error(response.message, response.status);
    }
  });
}